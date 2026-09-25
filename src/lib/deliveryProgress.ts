import type { DeliveryProgress } from "./tauri";

const PHASE_LABELS: Record<DeliveryProgress["phase"], string> = {
  scanning: "Scanning delivery folder",
  staging: "Extracting and copying files",
  analyzing: "Analyzing audio files",
  applying: "Applying changes",
  scanning_library: "Scanning project library",
};

export function formatDeliveryProgressDetail(progress: DeliveryProgress | null): string | undefined {
  if (!progress || progress.finished) {
    return undefined;
  }

  const phaseLabel = PHASE_LABELS[progress.phase];
  const parts: string[] = [phaseLabel];

  if (progress.current) {
    parts.push(progress.current);
  }

  if (progress.total > 0) {
    parts.push(`${progress.done} / ${progress.total}`);
  }

  return parts.join(" · ");
}

export function deliveryProgressPercent(progress: DeliveryProgress | null): number | null {
  if (!progress || progress.total <= 0) {
    return null;
  }
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}
