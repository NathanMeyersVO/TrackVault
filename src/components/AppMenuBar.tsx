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
    scanning,
    libraryUploading,
    collectionUploading,
    savingConfig,
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
    refreshProjectSchedule,
    refreshingSchedule,
    projectHubModal,
    deliveryUpdateModal,
    uploadToLibrary,
    uploadToCollection,
    openLibraryRemoteUpload,
    openCollectionRemoteUpload,
    remoteImportModal,
    scanLibrary,
    saveConfiguration,
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
      label: scanning ? "Staging delivery…" : "Apply Delivery Update…",
      title: "Import a vendor delivery into the active project (preview before apply).",
      onClick: () => void applyDeliveryUpdate(),
      disabled: libraryActionsDisabled,
    },
    {
      label: refreshingSchedule ? "Refreshing schedule…" : "Refresh Event Schedule",
      title: "Re-read event-schedule.xlsx and merge event titles.",
      onClick: () => void refreshProjectSchedule(),
      disabled: libraryActionsDisabled || refreshingSchedule,
    },
    {
      label: libraryUploading ? "Uploading to library…" : "Upload to Library",
      title: "Copy audio files into the library folder and add them to the index.",
      disabled: libraryUploadDisabled,
      children: [
        {
          label: libraryUploading ? "Uploading…" : "Upload locally…",
          title: "Choose audio files on this computer to copy into the library.",
          onClick: () => void uploadToLibrary(),
          disabled: libraryUploadDisabled,
        },
        {
          label: "Upload from phone…",
          title:
            "Receive audio over Wi‑Fi from your phone, then add them to the library.",
          onClick: () => openLibraryRemoteUpload(),
          disabled: libraryUploadDisabled,
        },
      ],
    },
    {
      label: scanning ? "Scanning…" : "Rescan Library",
      title:
        "Re-scan the library folder for new, changed, or removed files.",
      onClick: () => void scanLibrary(),
      disabled: libraryActionsDisabled,
    },
    {
      label: savingConfig ? "Exporting…" : "Export Library Configuration",
      title: "Write trackvault.json now (normally kept up to date automatically).",
      onClick: () => void saveConfiguration(),
      disabled: libraryActionsDisabled || savingConfig,
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
      children: [
        {
          label: collectionUploading ? "Uploading…" : "Upload locally…",
          title: "Choose audio files on this computer to copy into the collection.",
          onClick: () => void uploadToCollection(),
          disabled: collectionUploadDisabled,
        },
        {
          label: "Upload from phone…",
          title:
            "Receive audio over Wi‑Fi from your phone, then add them to the active collection.",
          onClick: () => openCollectionRemoteUpload(),
          disabled: collectionUploadDisabled,
        },
      ],
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
      {remoteImportModal}
      {projectHubModal}
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
