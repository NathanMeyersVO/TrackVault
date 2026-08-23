import type { ApplicationId } from "./tauri";

export interface TitleImportDialogConfig {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

export interface ApplicationConfig {
  supportsTitleImport: boolean;
  titleImportDialog?: TitleImportDialogConfig;
}

export const APPLICATION_CONFIG: Record<ApplicationId, ApplicationConfig> = {
  none: {
    supportsTitleImport: false,
  },
  usfs_ems: {
    supportsTitleImport: true,
    titleImportDialog: {
      title: "Choose event schedule",
      filters: [{ name: "Schedule", extensions: ["xls", "xlsx", "csv"] }],
    },
  },
};

export function getApplicationConfig(applicationId: ApplicationId): ApplicationConfig {
  return APPLICATION_CONFIG[applicationId];
}
