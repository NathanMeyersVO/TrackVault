import { usePlayerStore } from "../store/playerStore";

export function AudioCacheBanner() {
  const scan = usePlayerStore((state) => state.projectScanProgress);
  const projectLoadChecked = usePlayerStore((state) => state.projectLoadChecked);
  const projectLoad = usePlayerStore((state) => state.projectLoadProgress);

  const projectLoadVisible =
    !projectLoadChecked || (projectLoad != null && !projectLoad.finished);
  const scanning = !scan.finished;

  if (projectLoadVisible || !scanning) {
    return null;
  }

  const determinate = scan.total > 0;
  const percent = determinate
    ? Math.min(100, Math.round((scan.done / Math.max(scan.total, 1)) * 100))
    : 0;
  const label = determinate
    ? `Scanning project ${scan.done} / ${scan.total}`
    : "Scanning project…";

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
