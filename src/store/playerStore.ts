import { create } from "zustand";

import type { PlaybackState, Playlist, Track } from "../lib/tauri";

export type View = "library" | { playlistId: number };
export type TransportMode = "idle" | "seek" | "load";

const SEEK_CONFIRM_TOLERANCE_MS = 50;
const POSITION_GUARD_TOLERANCE_MS = 100;
export const SEEK_FALLBACK_MS = 15_000;

interface PlayerStore {
  tracks: Track[];
  playlists: Playlist[];
  view: View;
  cursorTrackId: number | null;
  activeTrackIds: number[];
  playback: PlaybackState;
  scanning: boolean;
  transportBusy: boolean;
  transportMode: TransportMode;
  lockedPositionMs: number | null;
  seekGeneration: number;
  positionGuardTargetMs: number | null;
  pendingPausedLoadTrackId: number | null;
  draggingTrackId: number | null;
  volume: number;
  setTracks: (tracks: Track[]) => void;
  setPlaylists: (playlists: Playlist[]) => void;
  setView: (view: View) => void;
  setCursorTrackId: (id: number | null) => void;
  setActiveTrackIds: (ids: number[]) => void;
  setPlayback: (playback: PlaybackState) => void;
  setScanning: (scanning: boolean) => void;
  beginTransport: (targetMs: number) => void;
  beginTrackLoad: (targetMs: number) => void;
  endTrackLoad: (result: PlaybackState) => void;
  releaseTransport: () => void;
  completeTransport: (result: PlaybackState, targetMs: number) => void;
  forceCompleteTransport: (targetMs: number) => void;
  setPendingPausedLoad: (trackId: number | null) => void;
  clearPendingPausedLoad: () => void;
  setDraggingTrackId: (id: number | null) => void;
  applyBackendPlayback: (incoming: PlaybackState) => void;
  setVolume: (volume: number) => void;
  patchTrack: (track: Track) => void;
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

export function isDisplayPositionPinned(
  state: Pick<PlayerStore, "transportBusy" | "positionGuardTargetMs">,
): boolean {
  return state.transportBusy || state.positionGuardTargetMs != null;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  tracks: [],
  playlists: [],
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
  transportBusy: false,
  transportMode: "idle",
  lockedPositionMs: null,
  seekGeneration: 0,
  positionGuardTargetMs: null,
  pendingPausedLoadTrackId: null,
  draggingTrackId: null,
  volume: 1,
  setTracks: (tracks) => set({ tracks }),
  setPlaylists: (playlists) => set({ playlists }),
  setView: (view) => set({ view }),
  setCursorTrackId: (cursorTrackId) => set({ cursorTrackId }),
  setActiveTrackIds: (activeTrackIds) => set({ activeTrackIds }),
  setPlayback: (playback) => set({ playback }),
  setScanning: (scanning) => set({ scanning }),
  beginTransport: (targetMs) =>
    set((state) => ({
      transportBusy: true,
      transportMode: "seek",
      lockedPositionMs: targetMs,
      seekGeneration: state.seekGeneration + 1,
      positionGuardTargetMs: null,
    })),
  beginTrackLoad: (targetMs) =>
    set((state) => ({
      transportBusy: true,
      transportMode: "load",
      lockedPositionMs: targetMs,
      seekGeneration: state.seekGeneration + 1,
      positionGuardTargetMs: null,
    })),
  endTrackLoad: (result) =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
      playback: result,
    }),
  releaseTransport: () =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
    }),
  completeTransport: (result, targetMs) =>
    set({
      transportBusy: false,
      transportMode: "idle",
      lockedPositionMs: null,
      playback: { ...result, position_ms: targetMs },
      positionGuardTargetMs: targetMs,
    }),
  forceCompleteTransport: (targetMs) => {
    const { playback } = get();
    get().completeTransport(playback, targetMs);
  },
  setPendingPausedLoad: (trackId) => set({ pendingPausedLoadTrackId: trackId }),
  clearPendingPausedLoad: () => set({ pendingPausedLoadTrackId: null }),
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
      if (
        Math.abs(incoming.position_ms - state.positionGuardTargetMs) >
        POSITION_GUARD_TOLERANCE_MS
      ) {
        return;
      }
      set({
        positionGuardTargetMs: null,
        playback: incoming,
      });
      return;
    }

    set({ playback: incoming });
  },
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  patchTrack: (track) =>
    set((state) => ({
      tracks: state.tracks.map((existing) =>
        existing.id === track.id ? track : existing,
      ),
    })),
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
