interface SeekIndicatorProps {
  className?: string;
}

export function SeekIndicator({ className = "" }: SeekIndicatorProps) {
  return (
    <span
      className={`inline-flex items-center justify-center text-base leading-none animate-pulse ${className}`}
      aria-live="polite"
      aria-label="Seeking…"
      title="Seeking…"
    >
      ⌛
    </span>
  );
}
