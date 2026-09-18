import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppearanceSettingsModal } from "./AppearanceSettingsModal";
import { DemoPrivacySettingsModal } from "./DemoPrivacySettingsModal";
import { AboutDialog } from "./AboutDialog";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { MenuBarStatus, MenuDropdown, type MenuEntry } from "./MenuDropdown";
import { useLibraryMenuActions } from "../hooks/useLibraryMenuActions";
import { useApplication } from "../hooks/useApplication";
import { useDemoPrivacy } from "../hooks/useDemoPrivacy";
import { APPLICATION_OPTIONS } from "../lib/applicationLabels";

export function AppMenuBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [demoPrivacyOpen, setDemoPrivacyOpen] = useState(false);
  const { demoModeEnabled, setDemoModeEnabled } = useDemoPrivacy();
  const {
    libraryFolder,
    collectionId,
    collectionName,
    scanning,
    libraryUploading,
    collectionUploading,
    savingConfig,
    loadingConfig,
    closingLibrary,
    importingCollection,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    dismissStatusFeedback,
    libraryUploadConfirmDialog,
    collectionUploadConfirmDialog,
    loadConfigConfirmDialog,
    closeLibraryConfirmDialog,
    changeLibraryConfirmDialog,
    chooseLibraryFolder,
    uploadToLibrary,
    uploadToCollection,
    scanLibrary,
    saveConfiguration,
    requestLoadConfiguration,
    requestCloseLibrary,
    importCollection,
    actionsDisabled,
    libraryActionsDisabled,
    libraryUploadDisabled,
    collectionUploadDisabled,
  } = useLibraryMenuActions();
  const { applicationId, selectApplication } = useApplication();

  const collectionUploadLabel =
    collectionName != null
      ? `Upload to stored collection (${collectionName})…`
      : "Upload to stored collection…";

  const libraryItems: MenuEntry[] = [
    {
      label: "Choose Library Folder",
      title:
        "Select the folder to scan for audio files and index in the library.",
      onClick: () => void chooseLibraryFolder(),
      disabled: actionsDisabled,
    },
    {
      label: libraryUploading ? "Uploading to library…" : "Upload to Library",
      title: "Copy audio files into the library folder and add them to the index.",
      onClick: () => void uploadToLibrary(),
      disabled: libraryUploadDisabled,
    },
    {
      label: scanning ? "Scanning…" : "Rescan Library",
      title:
        "Re-scan the library folder for new, changed, or removed files.",
      onClick: () => void scanLibrary(),
      disabled: libraryActionsDisabled,
    },
    {
      label: savingConfig ? "Saving…" : "Save Library Configuration",
      title:
        "Write library playlists and taglists to trackvault.json in the library folder.",
      onClick: () => void saveConfiguration(),
      disabled: libraryActionsDisabled || savingConfig,
    },
    {
      label: loadingConfig ? "Loading…" : "Load Library Configuration",
      title:
        "Replace library playlists and taglists from trackvault.json (indexed tracks unchanged).",
      onClick: () => void requestLoadConfiguration(),
      disabled: libraryActionsDisabled || loadingConfig,
    },
    {
      label: closingLibrary ? "Closing library…" : "Close Library",
      title:
        "Disconnect the library folder and clear indexed tracks, playlists, and taglists from the app.",
      onClick: () => void requestCloseLibrary(),
      disabled: actionsDisabled,
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
      onClick: () => void uploadToCollection(),
      disabled: collectionUploadDisabled,
    },
  ];

  const fileItems: MenuEntry[] = [
    {
      label: "Exit",
      title: "Quit TrackVault.",
      onClick: () => void getCurrentWindow().close(),
    },
  ];

  const applicationItems: MenuEntry[] = APPLICATION_OPTIONS.map((option) => ({
    label: option.label,
    title: option.title,
    checked: applicationId === option.id,
    onClick: () => {
      if (applicationId !== option.id) {
        void selectApplication(option.id);
      }
    },
  }));

  const viewItems: MenuEntry[] = [
    {
      label: "Demo mode",
      title:
        "Blur sensitive tag values on screen for this session (visual only).",
      checked: demoModeEnabled,
      onClick: () => setDemoModeEnabled(!demoModeEnabled),
    },
    {
      label: "Demo / privacy…",
      title: "Choose which tag keys are sensitive and filename blur options.",
      onClick: () => setDemoPrivacyOpen(true),
    },
    { separator: true },
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
      : libraryFolder ?? "No library folder chosen";

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
          <MenuDropdown label="Application" items={applicationItems} />
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
      {loadConfigConfirmDialog}
      {closeLibraryConfirmDialog}
      {changeLibraryConfirmDialog}
      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
      {appearanceOpen ? (
        <AppearanceSettingsModal onClose={() => setAppearanceOpen(false)} />
      ) : null}
      {demoPrivacyOpen ? (
        <DemoPrivacySettingsModal onClose={() => setDemoPrivacyOpen(false)} />
      ) : null}
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  );
}
