import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppearanceSettingsModal } from "./AppearanceSettingsModal";
import { AboutDialog } from "./AboutDialog";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { MenuBarStatus, MenuDropdown, type MenuEntry } from "./MenuDropdown";
import { useLibraryMenuActions } from "../hooks/useLibraryMenuActions";

export function AppMenuBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const {
    collectionId,
    collectionName,
    deliveryStaging,
    deliveryCopy,
    exportingProject,
    libraryUploading,
    collectionUploading,
    importingCollection,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    dismissStatusFeedback,
    libraryUploadConfirmDialog,
    collectionUploadConfirmDialog,
    activeProject,
    openProjectHub,
    applyDeliveryUpdate,
    projectHubModal,
    applyDeliveryPickerModal,
    deliveryFolderConfirmModal,
    deliveryUpdateModal,
    openLibraryUpload,
    openCollectionUpload,
    openPhoneUploadSettings,
    phoneUploadSettingsModal,
    uploadTracksModal,
    exportProject,
    importCollection,
    actionsDisabled,
    libraryActionsDisabled,
    libraryUploadDisabled,
    collectionUploadDisabled,
  } = useLibraryMenuActions();
  const collectionUploadLabel =
    collectionName != null
      ? `Upload to stored collection (${collectionName})…`
      : "Upload to stored collection…";

  const libraryItems: MenuEntry[] = [
    {
      label: "Projects…",
      title: "Create, open, or delete projects.",
      onClick: () => openProjectHub(),
      disabled: actionsDisabled,
    },
    {
      label: deliveryStaging
        ? deliveryCopy.applyUpdateMenuLabelStaging
        : deliveryCopy.applyUpdateMenuLabel,
      title: deliveryCopy.applyUpdateMenuTitle,
      onClick: () => void applyDeliveryUpdate(),
      disabled: libraryActionsDisabled || deliveryStaging,
    },
    {
      label: libraryUploading ? "Uploading to project library…" : "Upload to project library…",
      title:
        "Copy audio files into the project library folder (choose files, drag and drop, or upload from phone).",
      disabled: libraryUploadDisabled,
      onClick: () => openLibraryUpload(),
    },
    {
      label: exportingProject ? "Exporting project…" : "Export Project…",
      title: "Save the open project (project library audio, schedule, and trackvault.json) to a .tgz archive.",
      onClick: () => void exportProject(),
      disabled: libraryActionsDisabled || exportingProject,
    },
  ];

  const storedCollectionItems: MenuEntry[] = [
    {
      label: importingCollection ? "Importing…" : "Import stored collection",
      title: "Import a .tgz stored collection from disk.",
      onClick: () => void importCollection(),
      disabled: actionsDisabled,
    },
    {
      label: collectionUploading
        ? "Uploading to stored collection…"
        : collectionUploadLabel,
      title: "Copy audio files into the active stored collection.",
      disabled: collectionUploadDisabled,
      onClick: () => openCollectionUpload(),
    },
  ];

  const fileItems: MenuEntry[] = [
    {
      label: "Exit",
      title: "Quit TrackVault.",
      onClick: () => void getCurrentWindow().close(),
    },
  ];

  const viewItems: MenuEntry[] = [
    {
      label: "Appearance…",
      title: "Change color theme and appearance.",
      onClick: () => setAppearanceOpen(true),
    },
    {
      label: "Phone upload setup…",
      title:
        "Configure Cloudflare named tunnel for upload from phone (public HTTPS via your domain).",
      onClick: () => openPhoneUploadSettings(),
    },
  ];

  const helpItems: MenuEntry[] = [
    {
      label: "Keyboard shortcuts…",
      title: "View keyboard shortcuts for playback and navigation.",
      onClick: () => setShortcutsOpen(true),
    },
    {
      label: "About TrackVault…",
      title: "Version and application information.",
      onClick: () => setAboutOpen(true),
    },
  ];

  const statusMessage =
    uploadError ?? configError ?? uploadMessage ?? configMessage;
  const statusClassName =
    uploadError || configError
      ? "text-red-400"
      : uploadMessage || configMessage
        ? "text-green-400"
        : "text-muted";

  const statusLabel =
    collectionId != null && collectionName != null
      ? `Stored collection: ${collectionName}`
      : activeProject != null
        ? `Project: ${activeProject.name}`
        : "No project open";

  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-4 py-2">
        <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
          TrackVault
        </h1>
        <nav className="flex shrink-0 items-center gap-1">
          <MenuDropdown label="File" items={fileItems} />
          <MenuDropdown label="Library" items={libraryItems} />
          <MenuDropdown label="Stored Collections" items={storedCollectionItems} />
          <MenuDropdown label="View" items={viewItems} />
          <MenuDropdown label="Help" items={helpItems} />
        </nav>
        <div className="ml-auto flex min-w-0 max-w-[50%] flex-col items-end gap-0.5 text-right">
          <MenuBarStatus className="text-muted">{statusLabel}</MenuBarStatus>
          {statusMessage ? (
            <div className="flex min-w-0 items-center gap-1">
              <MenuBarStatus className={statusClassName}>{statusMessage}</MenuBarStatus>
              <button
                type="button"
                className="shrink-0 rounded px-1 text-xs leading-none text-muted hover:bg-surface-hover hover:text-foreground"
                aria-label="Dismiss status"
                onClick={dismissStatusFeedback}
              >
                ×
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {libraryUploadConfirmDialog}
      {collectionUploadConfirmDialog}
      {uploadTracksModal}
      {phoneUploadSettingsModal}
      {projectHubModal}
      {applyDeliveryPickerModal}
      {deliveryFolderConfirmModal}
      {deliveryUpdateModal}
      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
      {appearanceOpen ? (
        <AppearanceSettingsModal onClose={() => setAppearanceOpen(false)} />
      ) : null}
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  );
}
