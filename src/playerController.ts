import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { api, type Collection, type PlaybackState } from "./lib/tauri";
import {
  getContextTrackId,
  scheduleSeekFallback,
  scheduleTrackLoadFallback,
  serializeView,
  usePlayerStore,
  type PendingPausedLoad,
  type View,
} from "./store/playerStore";

const SELECT_PRELOAD_DELAY_MS = 300;
const AUTOPLAY_POLL_ATTEMPTS = 3;
const AUTOPLAY_POLL_INTERVAL_MS = 100;
const TRACK_END_TOLERANCE_MS = 100;
const CONTINUOUS_SAVE_DEBOUNCE_MS = 2000;

let initialized = false;
let deferredSelectPreloadId: number | null = null;
let unlistenPlaybackPosition: UnlistenFn | null = null;
let unsubscribeStore: (() => void) | null = null;
let handlingContinuousTrackEnd = false;
let continuousSaveTimerId: number | null = null;

function cancelDeferredSelectPreload() {
  if (deferredSelectPreloadId != null) {
    window.clearTimeout(deferredSelectPreloadId);
    deferredSelectPreloadId = null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function getViewCollectionId(view: View): number | null {
  if (typeof view === "object" && "collectionId" in view) {
    return view.collectionId;
  }
  return null;
}

function getContinuousCollection(
  collectionId: number | null,
): Collection | null {
  if (collectionId == null) return null;
  return (
    usePlayerStore
      .getState()
      .collections.find((collection) => collection.id === collectionId) ?? null
  );
}

function getContinuousVolumeScale(): number | null {
  const context = getActiveContinuousContext();
  if (!context) return null;
  const collection = getContinuousCollection(context.collectionId);
  return collection?.continuous_volume ?? 0.5;
}

function applyEffectiveVolume(masterVolume: number) {
  const scale = getContinuousVolumeScale();
  const effective =
    scale != null ? Math.min(1, Math.max(0, masterVolume * scale)) : masterVolume;
  void api.setVolume(effective);
}

function reapplyVolume() {
  applyEffectiveVolume(usePlayerStore.getState().volume);
}

function setContinuousContext(collectionId: number, trackIds: number[]) {
  usePlayerStore
    .getState()
    .setContinuousPlaybackContext(collectionId, trackIds);
  reapplyVolume();
}

function clearContinuousContext() {
  usePlayerStore.getState().setContinuousPlaybackContext(null, []);
  reapplyVolume();
}

function getActiveContinuousContext(): {
  collectionId: number;
  trackIds: number[];
} | null {
  const store = usePlayerStore.getState();
  const collection = getContinuousCollection(store.continuousPlaybackCollectionId);
  if (
    collection?.playback_mode !== "continuous" ||
    store.continuousPlaybackCollectionId == null
  ) {
    return null;
  }
  return {
    collectionId: store.continuousPlaybackCollectionId,
    trackIds: store.continuousPlaybackTrackIds,
  };
}

function maybeSetContinuousContextFromView(trackId: number) {
  const { view, activeTrackIds, collections } = usePlayerStore.getState();
  const collectionId = getViewCollectionId(view);
  if (collectionId == null) {
    clearContinuousContext();
    return;
  }

  const collection = collections.find((entry) => entry.id === collectionId);
  if (
    collection?.playback_mode === "continuous" &&
    activeTrackIds.includes(trackId)
  ) {
    setContinuousContext(collectionId, activeTrackIds);
    return;
  }

  clearContinuousContext();
}

async function getContinuousTrackIds(collectionId: number): Promise<number[]> {
  const store = usePlayerStore.getState();
  if (
    store.continuousPlaybackCollectionId === collectionId &&
    store.continuousPlaybackTrackIds.length > 0
  ) {
    return store.continuousPlaybackTrackIds;
  }

  const tracks = await api.getCollectionTracks(collectionId);
  const trackIds = tracks.map((track) => track.id);
  setContinuousContext(collectionId, trackIds);
  return trackIds;
}

async function saveContinuousPlaybackState() {
  if (handlingContinuousTrackEnd) return;

  const context = getActiveContinuousContext();
  if (!context) return;

  const { playback } = usePlayerStore.getState();
  if (playback.track_id == null) return;

  try {
    await api.saveCollectionPlaybackState(
      context.collectionId,
      playback.track_id,
      playback.position_ms,
    );
  } catch (error) {
    console.error(error);
  }
}

function scheduleContinuousPlaybackSave() {
  const context = getActiveContinuousContext();
  if (!context) return;

  const { playback } = usePlayerStore.getState();
  if (!playback.is_playing || playback.track_id == null) return;

  if (continuousSaveTimerId != null) {
    window.clearTimeout(continuousSaveTimerId);
  }

  continuousSaveTimerId = window.setTimeout(() => {
    continuousSaveTimerId = null;
    void saveContinuousPlaybackState();
  }, CONTINUOUS_SAVE_DEBOUNCE_MS);
}

function isNearTrackEnd(playback: PlaybackState): boolean {
  if (playback.track_id == null) return false;
  const duration = playback.duration_ms || 0;
  if (duration <= 0) return false;
  return playback.position_ms + TRACK_END_TOLERANCE_MS >= duration;
}

async function ensureAutoplay(trackId: number, initial: PlaybackState): Promise<PlaybackState> {
  let state = initial;

  for (let attempt = 0; attempt < AUTOPLAY_POLL_ATTEMPTS; attempt += 1) {
    if (state.track_id === trackId && state.is_playing) {
      return state;
    }
    await sleep(AUTOPLAY_POLL_INTERVAL_MS);
    state = await api.getPlaybackState();
  }

  if (state.track_id === trackId && !state.is_playing) {
    return api.resumePlayback();
  }

  return state;
}

async function loadTrack(trackId: number, startMs?: number, autoplay = true) {
  const store = usePlayerStore.getState();
  if (store.transportBusy) {
    if (autoplay) {
      store.setPendingPlayIntent({
        trackId,
        startMs: startMs ?? 0,
        autoplay: true,
      });
      store.setCursorTrackId(trackId);
    }
    return;
  }

  maybeSetContinuousContextFromView(trackId);

  store.clearPendingPausedLoad();
  store.clearPendingPlayIntent();

  const start = startMs ?? 0;
  store.beginTrackLoad(start, autoplay);
  store.setCursorTrackId(trackId);
  store.setPlayback({
    ...usePlayerStore.getState().playback,
    is_playing: false,
  });

  const loadGeneration = usePlayerStore.getState().seekGeneration;
  const requestedAutoplay = autoplay;

  try {
    let state = await api.playTrack(trackId, startMs, autoplay);
    if (requestedAutoplay && state.track_id === trackId && !state.is_playing) {
      state = await ensureAutoplay(trackId, state);
    }
    store.endTrackLoad(state);
    if (getActiveContinuousContext()) {
      void saveContinuousPlaybackState();
    }
  } catch {
    store.releaseTransport();
  } finally {
    scheduleTrackLoadFallback(loadGeneration);
  }
}

function isTrackInActiveList(trackId: number | null): boolean {
  if (trackId == null) return false;
  return usePlayerStore.getState().activeTrackIds.includes(trackId);
}

async function resolveContinuousRestoreTarget(
  collectionId: number,
  trackIds: number[],
  fallbackTrackId: number | null,
): Promise<{ trackId: number; positionMs: number } | null> {
  if (trackIds.length === 0) return null;

  const saved = await api.getCollectionPlaybackState(collectionId);
  let trackId = saved.track_id;
  let positionMs = saved.position_ms;

  if (trackId == null || !trackIds.includes(trackId)) {
    trackId = fallbackTrackId ?? trackIds[0] ?? null;
    positionMs = 0;
  }

  if (trackId == null) return null;
  return { trackId, positionMs };
}

async function restoreContinuousPlayback(
  collectionId: number,
  fallbackTrackId: number | null,
  autoplay = true,
): Promise<boolean> {
  const trackIds = await getContinuousTrackIds(collectionId);
  const target = await resolveContinuousRestoreTarget(
    collectionId,
    trackIds,
    fallbackTrackId,
  );
  if (target == null) return false;

  await loadTrack(target.trackId, target.positionMs, autoplay);
  return true;
}

function activateTracklistContext(target: PendingPausedLoad) {
  const store = usePlayerStore.getState();
  store.setCursorTrackId(target.trackId);
  cancelDeferredSelectPreload();

  const { playback, transportBusy } = store;
  if (transportBusy) return;

  if (playback.is_playing) {
    if (
      playback.track_id !== target.trackId ||
      playback.position_ms !== target.startMs
    ) {
      store.setPendingPausedLoad(target);
    }
    return;
  }

  if (
    playback.track_id === target.trackId &&
    playback.position_ms === target.startMs
  ) {
    return;
  }

  void loadTrack(target.trackId, target.startMs, false);
}

function syncTracklistContext(
  viewKey: string,
  trackIds: number[],
  target?: PendingPausedLoad,
) {
  const store = usePlayerStore.getState();
  if (serializeView(store.view) !== viewKey) return;

  const contextTrackId = getContextTrackId(store);
  if (contextTrackId != null && trackIds.includes(contextTrackId)) {
    return;
  }

  if (trackIds.length === 0) {
    store.setCursorTrackId(null);
    store.clearPendingPausedLoad();
    cancelDeferredSelectPreload();
    return;
  }

  const resolvedTarget: PendingPausedLoad = target ?? {
    trackId: trackIds[0]!,
    startMs: 0,
  };
  if (!trackIds.includes(resolvedTarget.trackId)) {
    resolvedTarget.trackId = trackIds[0]!;
    resolvedTarget.startMs = 0;
  }

  activateTracklistContext(resolvedTarget);
}

async function syncContinuousCollectionContext(
  collectionId: number,
  trackIds: number[],
  viewKey: string,
): Promise<void> {
  if (usePlayerStore.getState().transportBusy) return;

  setContinuousContext(collectionId, trackIds);

  if (serializeView(usePlayerStore.getState().view) !== viewKey) return;

  const restoreTarget = await resolveContinuousRestoreTarget(
    collectionId,
    trackIds,
    trackIds[0] ?? null,
  );
  if (restoreTarget == null) {
    syncTracklistContext(viewKey, trackIds);
    return;
  }

  syncTracklistContext(viewKey, trackIds, {
    trackId: restoreTarget.trackId,
    startMs: restoreTarget.positionMs,
  });
}

async function preloadContinuousCollectionPosition(
  collectionId: number,
  trackIds: number[],
): Promise<void> {
  const viewKey = serializeView({ collectionId });
  await syncContinuousCollectionContext(collectionId, trackIds, viewKey);
}

async function handleContinuousTrackEnd() {
  if (handlingContinuousTrackEnd) return;

  const context = getActiveContinuousContext();
  if (!context) return;

  const store = usePlayerStore.getState();
  const { playback, transportBusy, pendingPausedLoad } = store;
  if (transportBusy || pendingPausedLoad != null) return;
  if (playback.is_playing || playback.track_id == null) return;
  if (!isNearTrackEnd(playback)) return;

  handlingContinuousTrackEnd = true;
  try {
    const trackIds = await getContinuousTrackIds(context.collectionId);
    if (trackIds.length === 0) return;

    const currentIndex = trackIds.indexOf(playback.track_id);
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % trackIds.length : 0;
    const nextId = trackIds[nextIndex];
    if (nextId == null) return;

    await loadTrack(nextId, 0, true);
    await api.saveCollectionPlaybackState(context.collectionId, nextId, 0);
  } finally {
    handlingContinuousTrackEnd = false;
  }
}

function flushPendingPlayIntent() {
  const store = usePlayerStore.getState();
  if (store.transportBusy || !store.pendingPlayIntent) return;

  const intent = store.pendingPlayIntent;
  const loadedState = store.playback;
  store.clearPendingPlayIntent();

  if (
    intent.trackId === loadedState.track_id &&
    intent.autoplay &&
    !loadedState.is_playing
  ) {
    void api
      .resumePlayback()
      .then(store.setPlayback)
      .catch(() => {
        void loadTrack(intent.trackId, intent.startMs, intent.autoplay);
      });
    return;
  }

  if (
    intent.trackId !== loadedState.track_id ||
    (intent.autoplay && !loadedState.is_playing)
  ) {
    void loadTrack(intent.trackId, intent.startMs, intent.autoplay);
  }
}

function flushPendingPausedLoad() {
  const store = usePlayerStore.getState();
  if (store.playback.is_playing) return;
  if (store.transportBusy) return;
  if (store.pendingPausedLoad == null) return;

  const pending = store.pendingPausedLoad;
  store.clearPendingPausedLoad();
  void loadTrack(pending.trackId, pending.startMs, false);
}

function selectTrack(trackId: number) {
  const store = usePlayerStore.getState();
  store.setCursorTrackId(trackId);
  cancelDeferredSelectPreload();

  const { playback: currentPlayback, transportBusy } = store;
  if (transportBusy) return;

  if (currentPlayback.is_playing) {
    if (currentPlayback.track_id !== trackId) {
      store.setPendingPausedLoad({ trackId, startMs: 0 });
    }
    return;
  }

  if (currentPlayback.track_id === trackId) return;

  deferredSelectPreloadId = window.setTimeout(() => {
    deferredSelectPreloadId = null;
    void loadTrack(trackId, 0, false);
  }, SELECT_PRELOAD_DELAY_MS);
}

async function playTrack(trackId: number, startMs?: number) {
  cancelDeferredSelectPreload();
  await loadTrack(trackId, startMs ?? 0, true);
}

async function togglePlayPause(previewPositionMs = 0) {
  const store = usePlayerStore.getState();
  if (store.transportBusy) return;

  const { playback, cursorTrackId, view } = store;
  if (playback.is_playing) {
    store.setPlayback(await api.pausePlayback());
    await saveContinuousPlaybackState();
    return;
  }

  const collectionId = getViewCollectionId(view);
  const collection = getContinuousCollection(collectionId);
  const isContinuousView =
    collection?.playback_mode === "continuous" && collectionId != null;

  if (playback.track_id) {
    if (isContinuousView && !isTrackInActiveList(playback.track_id)) {
      const restored = await restoreContinuousPlayback(
        collectionId,
        cursorTrackId,
        true,
      );
      if (restored) return;
    }
    store.setPlayback(await api.resumePlayback());
    return;
  }

  if (isContinuousView) {
    const restored = await restoreContinuousPlayback(
      collectionId,
      cursorTrackId,
      true,
    );
    if (restored) return;
  }

  if (cursorTrackId) {
    await playTrack(cursorTrackId, previewPositionMs);
  }
}

function setVolume(volume: number) {
  const clamped = Math.min(1, Math.max(0, volume));
  usePlayerStore.getState().setVolume(clamped);
  applyEffectiveVolume(clamped);
}

function adjustVolume(delta: number) {
  const next = Math.min(1, Math.max(0, usePlayerStore.getState().volume + delta));
  setVolume(next);
}

async function seek(positionMs: number) {
  const store = usePlayerStore.getState();
  if (store.transportBusy) return;
  if (!store.playback.track_id) return;

  store.beginTransport(positionMs);
  const seekGeneration = store.seekGeneration;

  try {
    const result = await api.seekPlayback(positionMs);
    usePlayerStore.getState().completeTransport(result, positionMs);
    scheduleContinuousPlaybackSave();
  } catch {
    // Seek was queued; stay pinned until emitter confirms or fallback fires.
  }

  scheduleSeekFallback(seekGeneration, positionMs);
}

async function stop() {
  const store = usePlayerStore.getState();
  if (store.transportBusy) return;
  if (!store.playback.track_id) return;

  if (getActiveContinuousContext()) {
    if (store.playback.is_playing) {
      store.setPlayback(await api.pausePlayback());
    }
    await saveContinuousPlaybackState();
    return;
  }

  store.beginTransport(0);
  const seekGeneration = store.seekGeneration;

  try {
    const result = await api.stopPlayback();
    usePlayerStore.getState().completeTransport(result, 0);
  } catch {
    // Stop was queued; stay pinned until emitter confirms or fallback fires.
  }

  scheduleSeekFallback(seekGeneration, 0);
}

async function seekToStart() {
  if (usePlayerStore.getState().playback.track_id) {
    await seek(0);
  }
}

async function seekToEnd() {
  const { playback } = usePlayerStore.getState();
  if (!playback.track_id) return;
  const duration = playback.duration_ms || 0;
  await seek(Math.max(0, duration - 1000));
}

export const playerController = {
  loadTrack,
  selectTrack,
  playTrack,
  togglePlayPause,
  setVolume,
  adjustVolume,
  seek,
  stop,
  seekToStart,
  seekToEnd,
  reapplyVolume,
  syncTracklistContext,
  syncContinuousCollectionContext,
  preloadContinuousCollectionPosition,
};

export function initPlayerController() {
  if (initialized) return;
  initialized = true;

  const store = usePlayerStore.getState();
  void api.getPlaybackState().then(store.setPlayback).catch(console.error);
  void api.getVolume().then(store.setVolume).catch(console.error);

  void listen<PlaybackState>("playback-position", (event) => {
    usePlayerStore.getState().applyBackendPlayback(event.payload);
    scheduleContinuousPlaybackSave();
  }).then((unlisten) => {
    unlistenPlaybackPosition = unlisten;
  });

  let prevTransportBusy = store.transportBusy;
  let prevIsPlaying = store.playback.is_playing;

  unsubscribeStore = usePlayerStore.subscribe((state) => {
    if (prevTransportBusy && !state.transportBusy) {
      flushPendingPlayIntent();
    }
    prevTransportBusy = state.transportBusy;

    if (prevIsPlaying && !state.playback.is_playing) {
      if (state.pendingPausedLoad == null && !state.transportBusy) {
        void handleContinuousTrackEnd();
      } else if (!state.playback.is_playing) {
        void saveContinuousPlaybackState();
      }
    }

    if (prevIsPlaying !== state.playback.is_playing) {
      flushPendingPausedLoad();
    }
    prevIsPlaying = state.playback.is_playing;
  });
}

export function disposePlayerController() {
  cancelDeferredSelectPreload();
  if (continuousSaveTimerId != null) {
    window.clearTimeout(continuousSaveTimerId);
    continuousSaveTimerId = null;
  }
  unlistenPlaybackPosition?.();
  unlistenPlaybackPosition = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  initialized = false;
}
