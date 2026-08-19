import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { api } from "../lib/tauri";
import {
  scheduleSeekFallback,
  scheduleTrackLoadFallback,
  usePlayerStore,
} from "../store/playerStore";

export function useLibrary() {
  const { setTracks, setPlaylists, setTaglists, setScanning, setLibraryFolder } =
    usePlayerStore();

  const refresh = useCallback(async () => {
    const [tracks, playlists, taglists, libraryFolder] = await Promise.all([
      api.listTracks(),
      api.listPlaylists(),
      api.listTaglists(),
      api.getLibraryFolder(),
    ]);
    setTracks(tracks);
    setPlaylists(playlists);
    setTaglists(taglists);
    setLibraryFolder(libraryFolder);
  }, [setTracks, setPlaylists, setTaglists, setLibraryFolder]);

  useEffect(() => {
    refresh().catch(console.error);

    const unlisten = listen("library-updated", () => {
      refresh().catch(console.error);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const scanLibrary = useCallback(async () => {
    setScanning(true);
    try {
      await api.scanLibrary();
      await refresh();
    } finally {
      setScanning(false);
    }
  }, [refresh, setScanning]);

  return { refresh, scanLibrary };
}

export const VOLUME_STEP = 0.05;

export function usePlayer() {
  const {
    playback,
    cursorTrackId,
    setPlayback,
    setCursorTrackId,
    setVolume: setStoreVolume,
    beginTransport,
    beginTrackLoad,
    endTrackLoad,
    releaseTransport,
    setPendingPausedLoad,
    clearPendingPausedLoad,
  } = usePlayerStore();

  useEffect(() => {
    api.getPlaybackState().then(setPlayback).catch(console.error);
    api.getVolume().then(setStoreVolume).catch(console.error);

    const unlisten = listen<typeof playback>("playback-position", (event) => {
      usePlayerStore.getState().applyBackendPlayback(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setPlayback, setStoreVolume]);

  const setVolume = useCallback(
    (volume: number) => {
      const clamped = Math.min(1, Math.max(0, volume));
      setStoreVolume(clamped);
      void api.setVolume(clamped);
    },
    [setStoreVolume],
  );

  const adjustVolume = useCallback(
    (delta: number) => {
      const next = Math.min(1, Math.max(0, usePlayerStore.getState().volume + delta));
      setVolume(next);
    },
    [setVolume],
  );

  const loadTrack = useCallback(
    async (trackId: number, startMs?: number, autoplay = true) => {
      if (usePlayerStore.getState().transportBusy) return;

      clearPendingPausedLoad();

      const start = startMs ?? 0;
      beginTrackLoad(start);
      setCursorTrackId(trackId);
      setPlayback({
        ...usePlayerStore.getState().playback,
        is_playing: false,
      });

      const loadGeneration = usePlayerStore.getState().seekGeneration;

      try {
        const state = await api.playTrack(trackId, startMs, autoplay);
        endTrackLoad(state);
      } catch {
        releaseTransport();
      } finally {
        scheduleTrackLoadFallback(loadGeneration);
      }
    },
    [
      beginTrackLoad,
      clearPendingPausedLoad,
      endTrackLoad,
      releaseTransport,
      setCursorTrackId,
      setPlayback,
    ],
  );

  const loadTrackRef = useRef(loadTrack);
  loadTrackRef.current = loadTrack;

  useEffect(() => {
    const { playback: currentPlayback, pendingPausedLoadTrackId, transportBusy } =
      usePlayerStore.getState();

    if (currentPlayback.is_playing) return;
    if (transportBusy) return;
    if (pendingPausedLoadTrackId == null) return;

    const trackId = pendingPausedLoadTrackId;
    clearPendingPausedLoad();
    void loadTrackRef.current(trackId, 0, false);
  }, [playback.is_playing, clearPendingPausedLoad]);

  const selectTrack = useCallback(
    (trackId: number) => {
      setCursorTrackId(trackId);

      const { playback: currentPlayback, transportBusy } = usePlayerStore.getState();
      if (transportBusy) return;

      if (currentPlayback.is_playing) {
        if (currentPlayback.track_id !== trackId) {
          setPendingPausedLoad(trackId);
        }
        return;
      }

      if (currentPlayback.track_id === trackId) return;
      void loadTrack(trackId, 0, false);
    },
    [loadTrack, setCursorTrackId, setPendingPausedLoad],
  );

  const playTrack = useCallback(
    async (trackId: number, startMs?: number) => {
      await loadTrack(trackId, startMs, true);
    },
    [loadTrack],
  );

  const togglePlayPause = useCallback(
    async (previewPositionMs = 0) => {
      if (usePlayerStore.getState().transportBusy) return;

      if (playback.is_playing) {
        setPlayback(await api.pausePlayback());
      } else if (playback.track_id) {
        setPlayback(await api.resumePlayback());
      } else if (cursorTrackId) {
        await playTrack(cursorTrackId, previewPositionMs);
      }
    },
    [playback.is_playing, playback.track_id, cursorTrackId, playTrack, setPlayback],
  );

  const seek = useCallback(
    async (positionMs: number) => {
      if (usePlayerStore.getState().transportBusy) return;
      if (!usePlayerStore.getState().playback.track_id) return;

      beginTransport(positionMs);
      const seekGeneration = usePlayerStore.getState().seekGeneration;

      try {
        await api.seekPlayback(positionMs);
      } catch {
        // Seek was queued; stay pinned until emitter confirms or fallback fires.
      }

      scheduleSeekFallback(seekGeneration, positionMs);
    },
    [beginTransport],
  );

  const stop = useCallback(async () => {
    if (usePlayerStore.getState().transportBusy) return;
    if (!usePlayerStore.getState().playback.track_id) return;

    beginTransport(0);
    const seekGeneration = usePlayerStore.getState().seekGeneration;

    try {
      await api.stopPlayback();
    } catch {
      // Stop was queued; stay pinned until emitter confirms or fallback fires.
    }

    scheduleSeekFallback(seekGeneration, 0);
  }, [beginTransport]);

  const seekToStart = useCallback(async () => {
    if (usePlayerStore.getState().playback.track_id) {
      await seek(0);
    }
  }, [seek]);

  const seekToEnd = useCallback(async () => {
    const { playback: currentPlayback } = usePlayerStore.getState();
    if (!currentPlayback.track_id) return;
    const duration = currentPlayback.duration_ms || 0;
    await seek(Math.max(0, duration - 1000));
  }, [seek]);

  return {
    playback,
    playTrack,
    selectTrack,
    togglePlayPause,
    setVolume,
    adjustVolume,
    seek,
    stop,
    seekToStart,
    seekToEnd,
  };
}
