import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

interface WaveformProps {
  trackId: number | null;
  peaks: number[];
  durationMs: number;
  positionMs: number;
  transportBusy?: boolean;
  displayPinned?: boolean;
  interactive?: boolean;
  onSeek: (positionMs: number) => Promise<void>;
}

export function Waveform({
  trackId,
  peaks,
  durationMs,
  positionMs,
  transportBusy = false,
  displayPinned = false,
  interactive = true,
  onSeek,
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const onSeekRef = useRef(onSeek);
  const transportBusyRef = useRef(transportBusy);

  onSeekRef.current = onSeek;
  transportBusyRef.current = transportBusy;

  useEffect(() => {
    if (!containerRef.current || !trackId || peaks.length === 0) {
      return;
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 72,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 2,
      normalize: true,
      interact: interactive && !transportBusy,
      waveColor: "#525252",
      progressColor: "#60a5fa",
      cursorColor: "#ffffff",
    });

    const durationSec = durationMs / 1000;
    ws.load("", [peaks], durationSec);

    ws.on("interaction", () => {
      if (transportBusyRef.current) return;
      const position = Math.round(ws.getCurrentTime() * 1000);
      void onSeekRef.current(position);
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [trackId, peaks, durationMs]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.setOptions({ interact: interactive && !transportBusy });
  }, [interactive, transportBusy]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || transportBusy || displayPinned) return;
    ws.setTime(positionMs / 1000);
  }, [positionMs, transportBusy, displayPinned]);

  if (!trackId) {
    return (
      <div className="flex h-[72px] items-center justify-center rounded-md bg-neutral-900 text-xs text-neutral-500">
        Select a track to view waveform
      </div>
    );
  }

  return <div ref={containerRef} className="w-full rounded-md bg-neutral-900" />;
}
