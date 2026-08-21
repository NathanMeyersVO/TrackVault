import { useState } from "react";

import { AppearanceSettingsModal } from "./AppearanceSettingsModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { MenuBarStatus, MenuDropdown, type MenuEntry } from "./MenuDropdown";
import { useLibraryMenuActions } from "../hooks/useLibraryMenuActions";

export function AppMenuBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
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
    libraryUploadConfirmDialog,
    collectionUploadConfirmDialog,
    loadConfigConfirmDialog,
    closeLibraryConfirmDialog,
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

  const collectionUploadLabel =
    collectionName != null
      ? `Upload to collection (${collectionName})…`
      : "Upload to collection…";

  const fileItems: MenuEntry[] = [
    {
      label: "Choose library folder",
      onClick: () => void chooseLibraryFolder(),
      disabled: actionsDisabled,
    },
    {
      label: libraryUploading ? "Uploading to library…" : "Upload to library…",
      onClick: () => void uploadToLibrary(),
      disabled: libraryUploadDisabled,
    },
    {
      label: collectionUploading
        ? "Uploading to collection…"
        : collectionUploadLabel,
      onClick: () => void uploadToCollection(),
      disabled: collectionUploadDisabled,
    },
    {
      label: importingCollection ? "Importing…" : "Import collection…",
      onClick: () => void importCollection(),
      disabled: actionsDisabled,
    },
    { separator: true },
    {
      label: scanning ? "Scanning…" : "Rescan library",
      onClick: () => void scanLibrary(),
      disabled: libraryActionsDisabled,
    },
    {
      label: savingConfig ? "Saving…" : "Save configuration",
      onClick: () => void saveConfiguration(),
      disabled: libraryActionsDisabled || savingConfig,
    },
    {
      label: loadingConfig ? "Loading…" : "Load configuration",
      onClick: () => void requestLoadConfiguration(),
      disabled: libraryActionsDisabled || loadingConfig,
    },
    { separator: true },
    {
      label: closingLibrary ? "Closing library…" : "Close library",
      onClick: () => void requestCloseLibrary(),
      disabled: actionsDisabled,
    },
  ];

  const viewItems: MenuEntry[] = [
    {
      label: "Appearance…",
      onClick: () => setAppearanceOpen(true),
    },
  ];

  const helpItems: MenuEntry[] = [
    {
      label: "Keyboard shortcuts…",
      onClick: () => setShortcutsOpen(true),
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
      ? `Collection: ${collectionName}`
      : libraryFolder ?? "No library folder chosen";

  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-4 py-2">
        <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
          TrackVault
        </h1>
        <nav className="flex shrink-0 items-center gap-1">
          <MenuDropdown label="File" items={fileItems} />
          <MenuDropdown label="View" items={viewItems} />
          <MenuDropdown label="Help" items={helpItems} />
        </nav>
        <div className="ml-auto min-w-0 max-w-[50%] text-right">
          {statusMessage ? (
            <MenuBarStatus className={statusClassName}>{statusMessage}</MenuBarStatus>
          ) : (
            <MenuBarStatus className="text-muted">{statusLabel}</MenuBarStatus>
          )}
        </div>
      </header>
      {libraryUploadConfirmDialog}
      {collectionUploadConfirmDialog}
      {loadConfigConfirmDialog}
      {closeLibraryConfirmDialog}
      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
      {appearanceOpen ? (
        <AppearanceSettingsModal onClose={() => setAppearanceOpen(false)} />
      ) : null}
    </>
  );
}
