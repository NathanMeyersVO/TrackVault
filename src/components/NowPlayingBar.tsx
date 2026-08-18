import { useCallback, useEffect, useState } from "react";

import { api, formatDuration } from "../lib/tauri";
import { usePlayer } from "../hooks/usePlayer";
import { usePlayerStore, getDisplayPositionMs, isDisplayPositionPinned } from "../store/playerStore";
import { TransportControls } from "./TransportControls";
import { VolumeControl } from "./VolumeControl";
import { SeekIndicator } from "./SeekIndicator";
import { Waveform } from "./Waveform";

export function NowPlayingBar() {
  const store = usePlayerStore();
  const { tracks, playback, cursorTrackId, transportBusy, transportMode, volume } = store;
  const {
    togglePlayPause,
    setVolume,
    seek,
    stop,
    seekToStart,
    seekToEnd,
  } = usePlayer();
  const [peaks, setPeaks] = useState<number[]>([]);
  const [peakDurationMs, setPeakDurationMs] = useState(0);
  const [previewPositionMs, setPreviewPositionMs] = useState(0);

  const hasLoadedTrack = playback.track_id !== null;
  const isPlaying = playback.is_playing;
  const displayTrackId =
    transportMode === "load" && cursorTrackId != null
      ? cursorTrackId
      : playback.track_id ?? cursorTrackId;
  const displayTrack = tracks.find((t) => t.id === displayTrackId);

  const durationMs =
    transportMode === "load" && displayTrack
      ? displayTrack.duration_ms
      : hasLoadedTrack
        ? playback.duration_ms || peakDurationMs
        : displayTrack?.duration_ms || peakDurationMs;

  const displayPositionMs = hasLoadedTrack
    ? getDisplayPositionMs(store)
    : previewPositionMs;

  const displayPinned = hasLoadedTrack && isDisplayPositionPinned(store);

  useEffect(() => {
    if (!displayTrackId) {
      setPeaks([]);
      setPeakDurationMs(0);
      setPreviewPositionMs(0);
      return;
    }

    let cancelled = false;
    api
      .getTrackPeaks(displayTrackId)
      .then((data) => {
        if (!cancelled) {
          setPeaks(data.peaks);
          setPeakDurationMs(data.duration_ms);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [displayTrackId]);

  useEffect(() => {
    if (hasLoadedTrack) {
      setPreviewPositionMs(0);
    }
  }, [hasLoadedTrack, playback.track_id]);

  const handleSeek = useCallback(
    async (positionMs: number) => {
      if (transportBusy) return;
      if (hasLoadedTrack) {
        await seek(positionMs);
      } else if (cursorTrackId) {
        setPreviewPositionMs(positionMs);
      }
    },
    [transportBusy, hasLoadedTrack, cursorTrackId, seek],
  );

  const handleSeekToStart = useCallback(async () => {
    if (transportBusy) return;
    if (hasLoadedTrack) {
      await seekToStart();
    } else if (cursorTrackId) {
      setPreviewPositionMs(0);
    }
  }, [transportBusy, hasLoadedTrack, cursorTrackId, seekToStart]);

  const handleSeekToEnd = useCallback(async () => {
    if (transportBusy) return;
    if (hasLoadedTrack) {
      await seekToEnd();
    } else if (cursorTrackId && durationMs > 0) {
      setPreviewPositionMs(Math.max(0, durationMs - 1000));
    }
  }, [transportBusy, hasLoadedTrack, cursorTrackId, durationMs, seekToEnd]);

  const handleTogglePlayPause = useCallback(async () => {
    if (transportBusy) return;
    await togglePlayPause(previewPositionMs);
  }, [transportBusy, togglePlayPause, previewPositionMs]);

  const handleStop = useCallback(async () => {
    if (transportBusy) return;
    await stop();
  }, [transportBusy, stop]);

  const canSeek = (hasLoadedTrack || cursorTrackId !== null) && !transportBusy;

  return (
    <footer className="border-t border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="mb-3 flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-lg text-neutral-500">
          ♪
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">
            {displayTrack?.title ?? "Not playing"}
          </div>
          <div className="truncate text-xs text-neutral-400">
            {displayTrack
              ? `${displayTrack.artist || "Unknown artist"} — ${displayTrack.album || "Unknown album"}`
              : "Choose a track from your library"}
          </div>
        </div>
        <TransportControls
          isPlaying={isPlaying}
          hasLoadedTrack={hasLoadedTrack}
          hasCursor={cursorTrackId !== null}
          transportBusy={transportBusy}
          onStop={handleStop}
          onSeekToStart={handleSeekToStart}
          onTogglePlayPause={handleTogglePlayPause}
          onSeekToEnd={handleSeekToEnd}
        />
        <VolumeControl volume={volume} onChange={setVolume} />
        <div className="flex w-36 shrink-0 items-center justify-end gap-1.5 text-xs tabular-nums text-neutral-400">
          {transportBusy && <SeekIndicator />}
          <span>
            {formatDuration(displayPositionMs)} / {formatDuration(durationMs)}
          </span>
        </div>
      </div>

      <div className="relative">
        <div className={transportBusy ? "opacity-60" : ""}>
          <Waveform
            trackId={displayTrackId}
            peaks={peaks}
            durationMs={durationMs}
            positionMs={displayPositionMs}
            transportBusy={transportBusy}
            displayPinned={displayPinned}
            interactive={canSeek}
            onSeek={handleSeek}
          />
        </div>
        {transportBusy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-neutral-950/40">
            <SeekIndicator className="text-2xl" />
          </div>
        )}
      </div>
    </footer>
  );
}
