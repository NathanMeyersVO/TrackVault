import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { api } from "../lib/tauri";
import { useLibrary } from "./usePlayer";
import { useUploadTracks } from "./useUploadTracks";
import { usePlayerStore } from "../store/playerStore";

export function useLibraryMenuActions() {
  const { libraryFolder, scanning, setScanning } = usePlayerStore();
  const { refresh, scanLibrary } = useLibrary();
  const {
    uploadTracks,
    uploading,
    uploadMessage,
    uploadError,
    uploadConfirmDialog,
    clearUploadFeedback,
  } = useUploadTracks();
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const chooseLibraryFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose library folder",
    });
    if (typeof selected !== "string") return;

    setScanning(true);
    setConfigError(null);
    setConfigMessage(null);
    clearUploadFeedback();
    try {
      await api.setLibraryFolder(selected);
      await refresh();
    } catch (err) {
      setConfigError(String(err));
      await refresh().catch(console.error);
    } finally {
      setScanning(false);
    }
  }, [clearUploadFeedback, refresh, setScanning]);

  const saveConfiguration = useCallback(async () => {
    setSavingConfig(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const savedPath = await api.saveLibraryConfig();
      setConfigMessage(`Saved to ${savedPath}`);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setSavingConfig(false);
    }
  }, [clearUploadFeedback]);

  const actionsDisabled = scanning || uploading;
  const libraryActionsDisabled = actionsDisabled || !libraryFolder;

  return {
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
  };
}
