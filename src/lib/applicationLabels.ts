import type { ApplicationId } from "./tauri";

export const APPLICATION_OPTIONS: {
  id: ApplicationId;
  label: string;
}[] = [
  { id: "none", label: "None" },
  { id: "usfs_ems", label: "USFigureSkating EMS" },
];

export function getApplicationLabel(applicationId: ApplicationId): string {
  return (
    APPLICATION_OPTIONS.find((option) => option.id === applicationId)?.label ??
    "None"
  );
}
