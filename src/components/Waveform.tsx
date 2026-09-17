import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

import { useAppearance } from "../hooks/useAppearance";

interface WaveformProps {
  trackId: number | null;
  peaks: number[];
  durationMs: number;
  positionMs: number;
  transportBusy?: boolean;
  interactive?: boolean;
  onSeek: (positionMs: number) => Promise<void>;
}

export function Waveform({
  trackId,
  peaks,
  durationMs,
  positionMs,
  transportBusy = false,
  interactive = true,
  onSeek,
}: WaveformProps) {
  const { settings } = useAppearance();
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const onSeekRef = useRef(onSeek);
  const transportBusyRef = useRef(transportBusy);
  const durationMsRef = useRef(durationMs);
  const positionMsRef = useRef(positionMs);
  const pendingUserSeekMsRef = useRef<number | null>(null);

  onSeekRef.current = onSeek;
  transportBusyRef.current = transportBusy;
  durationMsRef.current = durationMs;
  positionMsRef.current = positionMs;

  useEffect(() => {
    if (!containerRef.current || !trackId || peaks.length === 0 || durationMs <= 0) {
      return;
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 72,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 2,
      normalize: false,
      interact: interactive && !transportBusy,
      waveColor: settings.waveformWave,
      progressColor: settings.waveformProgress,
      cursorColor: settings.waveformCursor,
    });

    const durationSec = durationMs / 1000;
    ws.load("", [peaks], durationSec);

    const seekVisual = (relativeX: number): number | null => {
      const durationSec = durationMsRef.current / 1000;
      if (durationSec <= 0) return null;
      const newTime = relativeX * durationSec;
      ws.setTime(newTime);
      return Math.round(newTime * 1000);
    };

    ws.on("ready", () => {
      ws.setTime(positionMsRef.current / 1000);
    });

    ws.on("click", (relativeX) => {
      if (transportBusyRef.current) return;
      const targetMs = seekVisual(relativeX);
      if (targetMs == null) return;
      pendingUserSeekMsRef.current = targetMs;
      void onSeekRef.current(targetMs);
    });

    ws.on("drag", (relativeX) => {
      if (transportBusyRef.current) return;
      const targetMs = seekVisual(relativeX);
      if (targetMs == null) return;
      pendingUserSeekMsRef.current = targetMs;
    });

    ws.on("dragend", (relativeX) => {
      if (transportBusyRef.current) return;
      const targetMs = seekVisual(relativeX);
      if (targetMs == null) return;
      pendingUserSeekMsRef.current = targetMs;
      void onSeekRef.current(targetMs);
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [
    trackId,
    peaks,
    durationMs,
    settings.waveformWave,
    settings.waveformProgress,
    settings.waveformCursor,
  ]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.setOptions({ interact: interactive && !transportBusy });
  }, [interactive, transportBusy]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;

    const pending = pendingUserSeekMsRef.current;
    if (pending != null && positionMs !== pending) {
      return;
    }
    if (pending === positionMs) {
      pendingUserSeekMsRef.current = null;
    }

    ws.setTime(positionMs / 1000);
  }, [positionMs]);

  if (!trackId) {
    return (
      <div className="flex h-[72px] items-center justify-center rounded-md bg-surface text-xs text-muted">
        Select a track to view waveform
      </div>
    );
  }

  return <div ref={containerRef} className="tv-waveform w-full rounded-md bg-surface" />;
}
