import { usePlayerStore } from "../store/playerStore";

export function AudioCacheBanner() {
  const progress = usePlayerStore((state) => state.audioCacheProgress);

  if (progress.finished || progress.total <= 0) {
    return null;
  }

  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          Preparing tracks {progress.done} / {progress.total}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full bg-accent transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
