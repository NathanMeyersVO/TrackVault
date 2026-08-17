interface TransportControlsProps {
  isPlaying: boolean;
  hasLoadedTrack: boolean;
  hasCursor: boolean;
  transportBusy: boolean;
  onStop: () => void;
  onSeekToStart: () => void;
  onTogglePlayPause: () => void;
  onSeekToEnd: () => void;
}

export function TransportControls({
  isPlaying,
  hasLoadedTrack,
  hasCursor,
  transportBusy,
  onStop,
  onSeekToStart,
  onTogglePlayPause,
  onSeekToEnd,
}: TransportControlsProps) {
  const canTransport = hasLoadedTrack || hasCursor;

  return (
    <div
      className={`flex items-center gap-1 ${transportBusy ? "pointer-events-none opacity-40" : ""}`}
    >
      <button
        onClick={onStop}
        disabled={transportBusy || !hasLoadedTrack}
        className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
        aria-label="Stop"
        title="Stop"
      >
        ■
      </button>
      <button
        onClick={onSeekToStart}
        disabled={transportBusy || !canTransport}
        className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
        aria-label="Jump to beginning"
        title="Jump to beginning"
      >
        ⏮
      </button>
      <button
        onClick={onTogglePlayPause}
        disabled={transportBusy || !canTransport}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 disabled:opacity-40"
        aria-label={isPlaying ? "Pause" : "Play"}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <button
        onClick={onSeekToEnd}
        disabled={transportBusy || !canTransport}
        className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
        aria-label="Jump to end"
        title="Jump to end"
      >
        ⏭
      </button>
    </div>
  );
}
