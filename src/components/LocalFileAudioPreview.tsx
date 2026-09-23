import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, formatDuration } from "../lib/tauri";

interface LocalFileAudioPreviewProps {
  filePath: string;
  durationMs: number;
  label: string;
  disabled?: boolean;
}

export function LocalFileAudioPreview({
  filePath,
  durationMs,
  label,
  disabled = false,
}: LocalFileAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const src = useMemo(() => convertFileSrc(filePath), [filePath]);

  useEffect(() => {
    setPlaying(false);
    setPositionMs(0);
    setError(null);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [filePath, src]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

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
  }, [disabled, playing]);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPositionMs(Math.round(audio.currentTime * 1000));
  }, []);

  const displayDurationMs = durationMs > 0 ? durationMs : positionMs;

  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-muted disabled:opacity-40"
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted">
            {formatDuration(positionMs)} / {formatDuration(displayDurationMs)}
          </p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(displayDurationMs);
        }}
        onTimeUpdate={onTimeUpdate}
        onError={() => setError("Could not play this audio file.")}
      />
    </div>
  );
}
