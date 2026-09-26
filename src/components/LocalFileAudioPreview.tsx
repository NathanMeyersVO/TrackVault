import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { api, formatDuration } from "../lib/tauri";

interface LocalFileAudioPreviewProps {
  filePath: string;
  durationMs: number;
  label: string;
  disabled?: boolean;
}

function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error loading audio for preview.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Could not decode this audio file for preview.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This audio file could not be loaded for preview.";
    default:
      return "Could not play this audio file.";
  }
}

export function LocalFileAudioPreview({
  filePath,
  durationMs,
  label,
  disabled = false,
}: LocalFileAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loadingSrc, setLoadingSrc] = useState(true);
  const seekingRef = useRef(false);

  const assetUrl = useMemo(() => convertFileSrc(filePath), [filePath]);

  useEffect(() => {
    let cancelled = false;

    setPlaying(false);
    setPositionMs(0);
    setMediaDurationMs(0);
    setError(null);
    setAudioSrc(null);
    setLoadingSrc(true);

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    const load = async () => {
      try {
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        const blob = await response.blob();
        if (cancelled) return;
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        setAudioSrc(blobUrl);
      } catch {
        if (cancelled) return;
        setAudioSrc(assetUrl);
      } finally {
        if (!cancelled) setLoadingSrc(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [assetUrl, filePath]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const effectiveDurationMs =
    durationMs > 0 ? durationMs : mediaDurationMs > 0 ? mediaDurationMs : 0;

  const previewDisabled = disabled || loadingSrc || !audioSrc;

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || previewDisabled) return;

    setError(null);
    if (playing) {
      audio.pause();
      return;
    }

    try {
      void api.pausePlayback();
      await audio.play();
    } catch (err) {
      setError(String(err));
      setPlaying(false);
    }
  }, [playing, previewDisabled]);

  const onTimeUpdate = useCallback(() => {
    if (seekingRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    setPositionMs(Math.round(audio.currentTime * 1000));
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    setMediaDurationMs(Math.round(audio.duration * 1000));
  }, []);

  const onAudioError = useCallback(() => {
    const code = audioRef.current?.error?.code;
    if (code === MediaError.MEDIA_ERR_ABORTED) return;
    setError(mediaErrorMessage(code));
    setPlaying(false);
  }, []);

  const seekToMs = useCallback(
    (targetMs: number) => {
      const audio = audioRef.current;
      if (!audio || previewDisabled || effectiveDurationMs <= 0) return;
      const clamped = Math.max(0, Math.min(targetMs, effectiveDurationMs));
      audio.currentTime = clamped / 1000;
      setPositionMs(clamped);
    },
    [effectiveDurationMs, previewDisabled],
  );

  const onSeekInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      seekingRef.current = true;
      seekToMs(Number(event.target.value));
    },
    [seekToMs],
  );

  const onSeekCommit = useCallback(() => {
    seekingRef.current = false;
  }, []);

  const displayDurationMs = effectiveDurationMs > 0 ? effectiveDurationMs : positionMs;

  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={previewDisabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-muted disabled:opacity-40"
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted">
            {loadingSrc
              ? "Loading preview…"
              : `${formatDuration(positionMs)} / ${formatDuration(displayDurationMs)}`}
          </p>
        </div>
      </div>
      {effectiveDurationMs > 0 && (
        <input
          type="range"
          min={0}
          max={effectiveDurationMs}
          value={Math.min(positionMs, effectiveDurationMs)}
          disabled={previewDisabled}
          onChange={onSeekInput}
          onMouseUp={onSeekCommit}
          onTouchEnd={onSeekCommit}
          className="mt-2 h-1 w-full cursor-pointer accent-accent disabled:opacity-40"
          aria-label={`Seek ${label}`}
          title="Seek"
        />
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {audioSrc ? (
        <audio
          key={filePath}
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPositionMs(displayDurationMs);
          }}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onError={onAudioError}
        />
      ) : null}
    </div>
  );
}
