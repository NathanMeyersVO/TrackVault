import { create } from "zustand";

import type { Collection, PlaybackState, Playlist, Taglist, Track } from "../lib/tauri";

export type View =
  | "library"
  | { playlistId: number }
  | { taglistId: number; value: string | null }
  | { collectionId: number };
export type TransportMode = "idle" | "seek" | "load";

export interface TaglistNav {
  hasNextSublist: boolean;
  activateNextSublist: () => void;
}

export interface PlayIntent {
  trackId: number;
  startMs: number;
  autoplay: boolean;
}

const SEEK_CONFIRM_TOLERANCE_MS = 50;
const POSITION_GUARD_TOLERANCE_MS = 100;
export const SEEK_FALLBACK_MS = 15_000;

export function shouldClearPositionGuard(
  guardTargetMs: number,
  incoming: PlaybackState,
): boolean {
  const delta = incoming.position_ms - guardTargetMs;
  if (Math.abs(delta) <= POSITION_GUARD_TOLERANCE_MS) {
    return true;
  }
  if (delta < -POSITION_GUARD_TOLERANCE_MS) {
    return false;
  }
  return incoming.is_playing;
}

export function mergeBackendPlaybackState(
  existing: PlaybackState,
  incoming: PlaybackState,
): PlaybackState {
  if (!incoming.is_playing && existing.track_id === incoming.track_id) {
    return {
      ...incoming,
      position_ms: existing.position_ms,
    };
  }
  return incoming;
}

interface PlayerStore {
  tracks: Track[];
  playlists: Playlist[];
  taglists: Taglist[];
  collections: Collection[];
  view: View;
  cursorTrackId: number | null;
  activeTrackIds: number[];
  playback: PlaybackState;
  scanning: boolean;
  libraryFolder: string | null;
  transportBusy: boolean;
  transportMode: TransportMode;
  lockedPositionMs: number | null;
  seekGeneration: number;
  positionGuardTargetMs: number | null;
  pendingPausedLoadTrackId: number | null;
  pendingPlayIntent: PlayIntent | null;
  loadAutoplayRequested: boolean;
  draggingTrackId: number | null;
  volume: number;
  taglistNav: TaglistNav | null;
  cursorTaglistFooter: boolean;
  pendingTaglistSelectFirst: boolean;
  setTracks: (tracks: Track[]) => void;
  setPlaylists: (playlists: Playlist[]) => void;
  setTaglists: (taglists: Taglist[]) => void;
  setCollections: (collections: Collection[]) => void;
  setView: (view: View) => void;
  setCursorTrackId: (id: number | null) => void;
  setActiveTrackIds: (ids: number[]) => void;
  setPlayback: (playback: PlaybackState) => void;
  setScanning: (scanning: boolean) => void;
  setLibraryFolder: (libraryFolder: string | null) => void;
  beginTransport: (targetMs: number) => void;
  beginTrackLoad: (targetMs: number, autoplay: boolean) => void;
  endTrackLoad: (result: PlaybackState) => void;
  releaseTransport: () => void;
  completeTransport: (result: PlaybackState, targetMs: number) => void;
  forceCompleteTransport: (targetMs: number) => void;
  setPendingPausedLoad: (trackId: number | null) => void;
  clearPendingPausedLoad: () => void;
  setPendingPlayIntent: (intent: PlayIntent | null) => void;
  clearPendingPlayIntent: () => void;
  setDraggingTrackId: (id: number | null) => void;
  applyBackendPlayback: (incoming: PlaybackState) => void;
  setVolume: (volume: number) => void;
  patchTrack: (track: Track) => void;
  setTaglistNav: (nav: TaglistNav | null) => void;
  setCursorTaglistFooter: (active: boolean) => void;
  setPendingTaglistSelectFirst: (pending: boolean) => void;
}

export function getDisplayPositionMs(
  state: Pick<
    PlayerStore,
    "transportBusy" | "lockedPositionMs" | "positionGuardTargetMs" | "playback"
  >,
): number {
  if (state.transportBusy && state.lockedPositionMs != null) {
    return state.lockedPositionMs;
  }
  if (state.positionGuardTargetMs != null) {
    return state.positionGuardTargetMs;
  }
  return state.playback.position_ms;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  tracks: [],
  playlists: [],
  taglists: [],
  collections: [],
  view: "library",
  cursorTrackId: null,
  activeTrackIds: [],
  playback: {
    track_id: null,
    position_ms: 0,
    duration_ms: 0,
    is_playing: false,
  },
  scanning: false,
  libraryFolder: null,
  transportBusy: false,
  transportMode: "idle",
  lockedPositionMs: null,
  seekGeneration: 0,
  positionGuardTargetMs: null,
  pendingPausedLoadTrackId: null,
  pendingPlayIntent: null,
  loadAutoplayRequested: false,
  draggingTrackId: null,
  volume: 1,
  taglistNav: null,
  cursorTaglistFooter: false,
  pendingTaglistSelectFirst: false,
  setTracks: (tracks) => set({ tracks }),
  setPlaylists: (playlists) => set({ playlists }),
  setTaglists: (taglists) => set({ taglists }),
  setCollections: (collections) => set({ collections }),
  setView: (view) => set({ view }),
  setCursorTrackId: (cursorTrackId) =>
    set((state) => ({
      cursorTrackId,
      cursorTaglistFooter:
        cursorTrackId != null ? false : state.cursorTaglistFooter,
    })),
  setActiveTrackIds: (activeTrackIds) => set({ activeTrackIds }),
  setPlayback: (playback) => set({ playback }),
  setScanning: (scanning) => set({ scanning }),
  setLibraryFolder: (libraryFolder) => set({ libraryFolder }),
  beginTransport: (targetMs) =>
    set((state) => ({
      transportBusy: true,
      transportMode: "seek",
      lockedPositionMs: targetMs,
      seekGeneration: state.seekGeneration + 1,
      positionGuardTargetMs: null,
      playback: { ...state.playback, position_ms: targetMs },
    })),
  beginTrackLoad: (targetMs, autoplay) =>
    set((state) => ({
      transportBusy: true,
      transportMode: "load",
      lockedPositionMs: targetMs,
      seekGeneration: state.seekGeneration + 1,
      positionGuardTargetMs: null,
      loadAutoplayRequested: autoplay,
    })),
  endTrackLoad: (result) =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
      loadAutoplayRequested: false,
      playback: result,
    }),
  releaseTransport: () =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
      loadAutoplayRequested: false,
    }),
  completeTransport: (result, targetMs) =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
      playback: { ...result, position_ms: targetMs },
      positionGuardTargetMs: result.is_playing ? targetMs : null,
    }),
  forceCompleteTransport: (targetMs) => {
    const { playback } = get();
    get().completeTransport(playback, targetMs);
  },
  setPendingPausedLoad: (trackId) => set({ pendingPausedLoadTrackId: trackId }),
  clearPendingPausedLoad: () => set({ pendingPausedLoadTrackId: null }),
  setPendingPlayIntent: (intent) => set({ pendingPlayIntent: intent }),
  clearPendingPlayIntent: () => set({ pendingPlayIntent: null }),
  setDraggingTrackId: (draggingTrackId) => set({ draggingTrackId }),
  applyBackendPlayback: (incoming) => {
    const state = get();

    if (state.transportBusy && state.transportMode === "load") {
      return;
    }

    if (
      state.transportBusy &&
      state.transportMode === "seek" &&
      state.lockedPositionMs != null
    ) {
      if (
        Math.abs(incoming.position_ms - state.lockedPositionMs) <=
        SEEK_CONFIRM_TOLERANCE_MS
      ) {
        get().completeTransport(incoming, state.lockedPositionMs);
      }
      return;
    }

    if (state.positionGuardTargetMs != null) {
      if (!shouldClearPositionGuard(state.positionGuardTargetMs, incoming)) {
        return;
      }
      set({
        positionGuardTargetMs: null,
        playback: mergeBackendPlaybackState(state.playback, incoming),
      });
      return;
    }

    set({ playback: mergeBackendPlaybackState(state.playback, incoming) });
  },
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  patchTrack: (track) =>
    set((state) => ({
      tracks: state.tracks.map((existing) =>
        existing.id === track.id ? track : existing,
      ),
    })),
  setTaglistNav: (taglistNav) => set({ taglistNav }),
  setCursorTaglistFooter: (active) =>
    set((state) => ({
      cursorTaglistFooter: active,
      cursorTrackId: active ? null : state.cursorTrackId,
    })),
  setPendingTaglistSelectFirst: (pendingTaglistSelectFirst) =>
    set({ pendingTaglistSelectFirst }),
}));

let transportFallbackId = 0;

export function scheduleSeekFallback(seekGeneration: number, targetMs: number) {
  const id = ++transportFallbackId;
  window.setTimeout(() => {
    if (id !== transportFallbackId) return;
    const state = usePlayerStore.getState();
    if (!state.transportBusy || state.transportMode !== "seek") return;
    if (state.seekGeneration !== seekGeneration) return;
    state.forceCompleteTransport(targetMs);
  }, SEEK_FALLBACK_MS);
}

export function scheduleTrackLoadFallback(loadGeneration: number) {
  const id = ++transportFallbackId;
  window.setTimeout(() => {
    if (id !== transportFallbackId) return;
    const state = usePlayerStore.getState();
    if (!state.transportBusy || state.transportMode !== "load") return;
    if (state.seekGeneration !== loadGeneration) return;
    state.releaseTransport();
  }, SEEK_FALLBACK_MS);
}
