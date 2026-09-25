import type { ProjectLoadPhase, ProjectLoadProgress } from "./tauri";

const PHASE_LABELS: Record<ProjectLoadPhase, string> = {
  opening: "Opening project",
  scanning: "Scanning project library",
  loading_config: "Loading project configuration",
  applying_setup: "Applying application setup",
};

export function formatProjectLoadProgressDetail(
  progress: ProjectLoadProgress | null,
): string | undefined {
  if (!progress || progress.finished) {
    return undefined;
  }

  const parts: string[] = [PHASE_LABELS[progress.phase]];

  if (progress.current) {
    parts.push(progress.current);
  }

  if (progress.total > 0) {
    parts.push(`${progress.done} / ${progress.total}`);
  }

  return parts.join(" · ");
}

export function projectLoadProgressPercent(
  progress: ProjectLoadProgress | null,
): number | null {
  if (!progress || progress.finished || progress.total <= 0) {
    return null;
  }
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}
