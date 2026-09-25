interface TrackSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: import("react").KeyboardEvent<HTMLInputElement>) => void;
}

export function TrackSearchInput({ value, onChange, onKeyDown }: TrackSearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Search project…"
      aria-label="Search project by entry tag or filename"
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
    />
  );
}
