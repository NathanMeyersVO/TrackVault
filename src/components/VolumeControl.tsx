interface VolumeControlProps {
  volume: number;
  onChange: (volume: number) => void;
}

export function VolumeControl({ volume, onChange }: VolumeControlProps) {
  const percent = Math.round(volume * 100);

  return (
    <div className="flex w-28 shrink-0 items-center gap-2">
      <span className="text-xs text-neutral-500" aria-hidden="true">
        Vol
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="h-1 w-full cursor-pointer accent-white"
        aria-label="Volume"
        title={`Volume ${percent}%`}
      />
    </div>
  );
}
