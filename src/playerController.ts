import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { api, type PlaybackState } from "./lib/tauri";
import {
  scheduleSeekFallback,
  scheduleTrackLoadFallback,
  usePlayerStore,
} from "./store/playerStore";

const SELECT_PRELOAD_DELAY_MS = 300;
const AUTOPLAY_POLL_ATTEMPTS = 3;
const AUTOPLAY_POLL_INTERVAL_MS = 100;

let initialized = false;
let deferredSelectPreloadId: number | null = null;
let unlistenPlaybackPosition: UnlistenFn | null = null;
let unsubscribeStore: (() => void) | null = null;

function cancelDeferredSelectPreload() {
  if (deferredSelectPreloadId != null) {
    window.clearTimeout(deferredSelectPreloadId);
    deferredSelectPreloadId = null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
  } catch {
    store.releaseTransport();
  } finally {
    scheduleTrackLoadFallback(loadGeneration);
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
  if (store.pendingPausedLoadTrackId == null) return;

  const trackId = store.pendingPausedLoadTrackId;
  store.clearPendingPausedLoad();
  void loadTrack(trackId, 0, false);
}

function selectTrack(trackId: number) {
  const store = usePlayerStore.getState();
  store.setCursorTrackId(trackId);
  cancelDeferredSelectPreload();

  const { playback: currentPlayback, transportBusy } = store;
  if (transportBusy) return;

  if (currentPlayback.is_playing) {
    if (currentPlayback.track_id !== trackId) {
      store.setPendingPausedLoad(trackId);
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
  await loadTrack(trackId, startMs, true);
}

async function togglePlayPause(previewPositionMs = 0) {
  const store = usePlayerStore.getState();
  if (store.transportBusy) return;

  const { playback, cursorTrackId } = store;
  if (playback.is_playing) {
    store.setPlayback(await api.pausePlayback());
  } else if (playback.track_id) {
    store.setPlayback(await api.resumePlayback());
  } else if (cursorTrackId) {
    await playTrack(cursorTrackId, previewPositionMs);
  }
}

function setVolume(volume: number) {
  const clamped = Math.min(1, Math.max(0, volume));
  usePlayerStore.getState().setVolume(clamped);
  void api.setVolume(clamped);
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
    await api.seekPlayback(positionMs);
  } catch {
    // Seek was queued; stay pinned until emitter confirms or fallback fires.
  }

  scheduleSeekFallback(seekGeneration, positionMs);
}

async function stop() {
  const store = usePlayerStore.getState();
  if (store.transportBusy) return;
  if (!store.playback.track_id) return;

  store.beginTransport(0);
  const seekGeneration = store.seekGeneration;

  try {
    await api.stopPlayback();
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
};

export function initPlayerController() {
  if (initialized) return;
  initialized = true;

  const store = usePlayerStore.getState();
  void api.getPlaybackState().then(store.setPlayback).catch(console.error);
  void api.getVolume().then(store.setVolume).catch(console.error);

  void listen<PlaybackState>("playback-position", (event) => {
    usePlayerStore.getState().applyBackendPlayback(event.payload);
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

    if (prevIsPlaying !== state.playback.is_playing) {
      flushPendingPausedLoad();
    }
    prevIsPlaying = state.playback.is_playing;
  });
}

export function disposePlayerController() {
  cancelDeferredSelectPreload();
  unlistenPlaybackPosition?.();
  unlistenPlaybackPosition = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  initialized = false;
}
