interface TrackSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function TrackSearchInput({ value, onChange }: TrackSearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search by title…"
      aria-label="Search tracks by title"
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
    />
  );
}
