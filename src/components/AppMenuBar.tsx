import { useState } from "react";

import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { MenuBarStatus, MenuDropdown, type MenuEntry } from "./MenuDropdown";
import { useLibraryMenuActions } from "../hooks/useLibraryMenuActions";

export function AppMenuBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const {
    libraryFolder,
    scanning,
    uploading,
    savingConfig,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    uploadConfirmDialog,
    chooseLibraryFolder,
    uploadTracks,
    scanLibrary,
    saveConfiguration,
    actionsDisabled,
    libraryActionsDisabled,
  } = useLibraryMenuActions();

  const fileItems: MenuEntry[] = [
    {
      label: "Choose library folder",
      onClick: () => void chooseLibraryFolder(),
      disabled: actionsDisabled,
    },
    {
      label: uploading ? "Uploading…" : "Upload tracks",
      onClick: () => void uploadTracks(),
      disabled: libraryActionsDisabled,
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
        : "text-neutral-400";

  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <h1 className="shrink-0 text-sm font-semibold tracking-tight text-white">
          TrackVault
        </h1>
        <nav className="flex shrink-0 items-center gap-1">
          <MenuDropdown label="File" items={fileItems} />
          <MenuDropdown label="Help" items={helpItems} />
        </nav>
        <div className="ml-auto min-w-0 max-w-[50%] text-right">
          {statusMessage ? (
            <MenuBarStatus className={statusClassName}>{statusMessage}</MenuBarStatus>
          ) : (
            <MenuBarStatus className="text-neutral-500">
              {libraryFolder ?? "No library folder chosen"}
            </MenuBarStatus>
          )}
        </div>
      </header>
      {uploadConfirmDialog}
      {shortcutsOpen ? (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </>
  );
}
