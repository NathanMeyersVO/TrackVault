import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { api } from "../lib/tauri";
import { scheduleSeekFallback, usePlayerStore } from "../store/playerStore";

export function useLibrary() {
  const { setTracks, setPlaylists, setScanning } = usePlayerStore();

  const refresh = useCallback(async () => {
    const [tracks, playlists] = await Promise.all([
      api.listTracks(),
      api.listPlaylists(),
    ]);
    setTracks(tracks);
    setPlaylists(playlists);
  }, [setTracks, setPlaylists]);

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

export function usePlayer() {
  const {
    playback,
    cursorTrackId,
    setPlayback,
    setCursorTrackId,
    beginTransport,
  } = usePlayerStore();

  useEffect(() => {
    api.getPlaybackState().then(setPlayback).catch(console.error);

    const unlisten = listen<typeof playback>("playback-position", (event) => {
      usePlayerStore.getState().applyBackendPlayback(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setPlayback]);

  const playTrack = useCallback(
    async (trackId: number, startMs?: number) => {
      setCursorTrackId(trackId);
      const state = await api.playTrack(trackId, startMs);
      setPlayback(state);
    },
    [setPlayback, setCursorTrackId],
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
    togglePlayPause,
    seek,
    stop,
    seekToStart,
    seekToEnd,
  };
}
