import type { ArchiveExportProgress } from "./tauri";

export function archiveExportTitle(progress: ArchiveExportProgress): string {
  const quoted = `"${progress.label}"`;
  if (progress.kind === "collection") {
    return `Exporting collection ${quoted}`;
  }
  return `Exporting project ${quoted}`;
}

export function formatArchiveExportDetail(
  progress: ArchiveExportProgress | null,
): string | undefined {
  if (!progress || progress.finished) {
    return undefined;
  }

  const parts: string[] = [];
  if (progress.current) {
    parts.push(progress.current);
  }
  if (progress.total > 0) {
    parts.push(`${progress.done} / ${progress.total}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function archiveExportPercent(
  progress: ArchiveExportProgress | null,
): number | null {
  if (!progress || progress.total <= 0) {
    return null;
  }
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}
