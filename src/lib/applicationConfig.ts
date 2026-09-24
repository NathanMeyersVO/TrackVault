import type { ApplicationId } from "./tauri";

export interface TitleImportDialogConfig {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

export interface DeliveryCopy {
  /** Singular noun for inline copy, e.g. "EMS download" */
  deliverySingular: string;
  createProjectHint: string;
  importButton: string;
  /** Projects hub drop target label (Explorer folder drag) */
  createProjectDropZoneLabel: string;
  pickFolderDialogTitle: string;
  confirmFolderModalTitle: string;
  applyUpdateMenuLabel: string;
  applyUpdateMenuLabelStaging: string;
  applyUpdateMenuTitle: string;
  applyUpdatePickerTitle: string;
  applyUpdateChooseFolderButton: string;
  applyUpdateDropZoneLabel: string;
  previewCreateTitle: string;
  previewApplyTitle: string;
  stagingBusyTitle: string;
  applyingBusyTitle: string;
  appliedSuccessMessage: string;
  libraryEmptyWithProject: string;
  appEmptyTracksFooter: string;
}

export interface ApplicationConfig {
  supportsTitleImport: boolean;
  supportsScheduleDelivery: boolean;
  titleImportDialog?: TitleImportDialogConfig;
  deliveryCopy: DeliveryCopy;
}

const NONE_DELIVERY_COPY: DeliveryCopy = {
  deliverySingular: "delivery",
  createProjectHint:
    "Choose a folder with audio archives and/or loose audio files.",
  importButton: "Import delivery…",
  createProjectDropZoneLabel: "Drop delivery folder here",
  pickFolderDialogTitle: "Select delivery folder",
  confirmFolderModalTitle: "Confirm delivery folder",
  applyUpdateMenuLabel: "Apply Delivery Update…",
  applyUpdateMenuLabelStaging: "Staging delivery…",
  applyUpdateMenuTitle:
    "Choose a delivery folder with audio archives and/or loose audio to preview and apply.",
  applyUpdatePickerTitle: "Apply delivery update",
  applyUpdateChooseFolderButton: "Choose folder…",
  applyUpdateDropZoneLabel: "Drop delivery folder here",
  previewCreateTitle: "Create project from delivery",
  previewApplyTitle: "Apply delivery update",
  stagingBusyTitle: "Staging delivery…",
  applyingBusyTitle: "Applying delivery update…",
  appliedSuccessMessage: "Delivery update applied",
  libraryEmptyWithProject:
    "No tracks yet. Library → Projects… (or Apply Delivery Update…) and choose your delivery folder.",
  appEmptyTracksFooter:
    "Use Library → Projects to import a delivery and open a project.",
};

const USFS_EMS_DELIVERY_COPY: DeliveryCopy = {
  deliverySingular: "EMS download",
  createProjectHint:
    "Choose a folder of EMS downloads with audio archives and/or an event schedule spreadsheet (.xls, .xlsx).",
  importButton: "Import EMS download…",
  createProjectDropZoneLabel: "Drop EMS download folder here",
  pickFolderDialogTitle: "Select EMS downloads folder",
  confirmFolderModalTitle: "Confirm EMS downloads folder",
  applyUpdateMenuLabel: "Apply EMS Download…",
  applyUpdateMenuLabelStaging: "Staging EMS download…",
  applyUpdateMenuTitle:
    "Choose a folder of EMS downloads (archives and/or event schedule) to preview and apply.",
  applyUpdatePickerTitle: "Apply EMS download",
  applyUpdateChooseFolderButton: "Choose folder…",
  applyUpdateDropZoneLabel: "Drop EMS download folder here",
  previewCreateTitle: "Create project from EMS download",
  previewApplyTitle: "Apply EMS download",
  stagingBusyTitle: "Staging EMS download…",
  applyingBusyTitle: "Applying EMS download…",
  appliedSuccessMessage: "EMS download applied",
  libraryEmptyWithProject:
    "No tracks yet. Library → Projects… (or Apply EMS Download…) and choose your EMS downloads folder.",
  appEmptyTracksFooter:
    "Use Library → Projects to import an EMS download and open a project.",
};

export const APPLICATION_CONFIG: Record<ApplicationId, ApplicationConfig> = {
  none: {
    supportsTitleImport: false,
    supportsScheduleDelivery: false,
    deliveryCopy: NONE_DELIVERY_COPY,
  },
  usfs_ems: {
    supportsTitleImport: true,
    supportsScheduleDelivery: true,
    titleImportDialog: {
      title: "Choose event schedule",
      filters: [{ name: "Schedule", extensions: ["xls", "xlsx", "csv"] }],
    },
    deliveryCopy: USFS_EMS_DELIVERY_COPY,
  },
};

export function normalizeApplicationId(applicationId: string | null | undefined): ApplicationId {
  return applicationId === "usfs_ems" ? "usfs_ems" : "none";
}

export function getApplicationConfig(applicationId: ApplicationId): ApplicationConfig {
  return APPLICATION_CONFIG[applicationId];
}

export function getDeliveryCopy(applicationId: string | null | undefined): DeliveryCopy {
  return getApplicationConfig(normalizeApplicationId(applicationId)).deliveryCopy;
}
