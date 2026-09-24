import { usePlayerStore } from "../store/playerStore";

export function AudioCacheBanner() {
  const scan = usePlayerStore((state) => state.libraryScanProgress);
  const cache = usePlayerStore((state) => state.audioCacheProgress);

  const scanning = !scan.finished;
  const preparing = !scanning && !cache.finished && cache.total > 0;

  if (!scanning && !preparing) {
    return null;
  }

  const determinate = scanning ? scan.total > 0 : true;
  const done = scanning ? scan.done : cache.done;
  const total = scanning ? scan.total : cache.total;
  const percent = determinate
    ? Math.min(100, Math.round((done / Math.max(total, 1)) * 100))
    : 0;
  const label = scanning
    ? determinate
      ? `Scanning project library ${done} / ${total}`
      : "Scanning project library…"
    : `Preparing tracks ${done} / ${total}`;

  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        {determinate ? <span>{percent}%</span> : null}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
        {determinate ? (
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="tv-indeterminate-bar h-full w-1/3 bg-accent" />
        )}
      </div>
    </div>
  );
}
