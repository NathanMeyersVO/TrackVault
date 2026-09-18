import type { ApplicationId } from "./tauri";

export const APPLICATION_OPTIONS: {
  id: ApplicationId;
  label: string;
  title?: string;
}[] = [
  {
    id: "none",
    label: "None",
    title: "No application-specific automation.",
  },
  {
    id: "usfs_ems",
    label: "USFigureSkating EMS",
    title: "Create taglist on 'Composer' tag. Use EMS Schedule XLS file.",
  },
];

export function getApplicationLabel(applicationId: ApplicationId): string {
  return (
    APPLICATION_OPTIONS.find((option) => option.id === applicationId)?.label ??
    "None"
  );
}
