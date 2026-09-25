import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppearanceSettingsModal } from "./AppearanceSettingsModal";
import { AboutDialog } from "./AboutDialog";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { MenuBarStatus, MenuDropdown, type MenuEntry } from "./MenuDropdown";
import { useProjectMenuActions } from "../hooks/useProjectMenuActions";
import { AppLogo } from "./AppLogo";

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
    projectUploading,
    collectionUploading,
    importingCollection,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    dismissStatusFeedback,
    projectUploadConfirmDialog,
    collectionUploadConfirmDialog,
    activeProject,
    openProjectHub,
    applyDeliveryUpdate,
    projectHubModal,
    applyDeliveryPickerModal,
    deliveryFolderConfirmModal,
    deliveryUpdateModal,
    openProjectUpload,
    openCollectionUpload,
    openPhoneUploadSettings,
    phoneUploadSettingsModal,
    uploadTracksModal,
    exportProject,
    importCollection,
    actionsDisabled,
    projectActionsDisabled,
    projectUploadDisabled,
    collectionUploadDisabled,
  } = useProjectMenuActions();
  const collectionUploadLabel =
    collectionName != null
      ? `Upload track to stored collection (${collectionName})…`
      : "Upload track to stored collection…";

  const projectItems: MenuEntry[] = [
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
      disabled: projectActionsDisabled || deliveryStaging,
    },
    {
      label: projectUploading ? "Uploading to project…" : "Upload track to project…",
      title:
        "Copy audio files into the project folder (choose files, drag and drop, or upload from phone).",
      disabled: projectUploadDisabled,
      onClick: () => openProjectUpload(),
    },
    {
      label: exportingProject ? "Exporting project…" : "Export Project…",
      title: "Save the open project (project audio, schedule, and trackvault.json) to a .tvproject.zip archive.",
      onClick: () => void exportProject(),
      disabled: projectActionsDisabled || exportingProject,
    },
  ];

  const storedCollectionItems: MenuEntry[] = [
    {
      label: importingCollection ? "Importing…" : "Import stored collection",
      title: "Import a .tvcollection.zip stored collection from disk.",
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
        <AppLogo className="h-8 w-auto max-w-[11rem] shrink-0 object-contain object-left" />
        <nav className="flex shrink-0 items-center gap-1">
          <MenuDropdown label="File" items={fileItems} />
          <MenuDropdown label="Project" items={projectItems} />
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
      {projectUploadConfirmDialog}
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
