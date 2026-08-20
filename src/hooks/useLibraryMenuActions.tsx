import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { api } from "../lib/tauri";
import { clearTrackTagsCache } from "../lib/trackTagsCache";
import { useLibrary } from "./usePlayer";
import { useUploadTracks } from "./useUploadTracks";
import { usePlayerStore } from "../store/playerStore";

export function useLibraryMenuActions() {
  const {
    libraryFolder,
    scanning,
    setScanning,
    setView,
    setCursorTrackId,
    setActiveTrackIds,
    setPlayback,
    clearPendingPausedLoad,
  } = usePlayerStore();
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
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadConfigConfirmOpen, setLoadConfigConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

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

  const requestLoadConfiguration = useCallback(() => {
    if (!libraryFolder) return;
    setLoadConfigConfirmOpen(true);
  }, [libraryFolder]);

  const cancelLoadConfiguration = useCallback(() => {
    if (loadingConfig) return;
    setLoadConfigConfirmOpen(false);
  }, [loadingConfig]);

  const confirmLoadConfiguration = useCallback(async () => {
    setLoadingConfig(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const loadedPath = await api.loadLibraryConfig();
      await refresh();
      setConfigMessage(`Loaded from ${loadedPath}`);
      setLoadConfigConfirmOpen(false);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, [clearUploadFeedback, refresh]);

  const requestResetLibrary = useCallback(() => {
    setResetConfirmOpen(true);
  }, []);

  const cancelResetLibrary = useCallback(() => {
    if (resetting) return;
    setResetConfirmOpen(false);
  }, [resetting]);

  const confirmResetLibrary = useCallback(async () => {
    setResetting(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const playback = await api.resetLibrary();
      setPlayback(playback);
      setView("library");
      setCursorTrackId(null);
      setActiveTrackIds([]);
      clearPendingPausedLoad();
      clearTrackTagsCache();
      await refresh();
      setConfigMessage("Reset to initial state");
      setResetConfirmOpen(false);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setResetting(false);
    }
  }, [
    clearPendingPausedLoad,
    clearUploadFeedback,
    refresh,
    setActiveTrackIds,
    setCursorTrackId,
    setPlayback,
    setView,
  ]);

  const loadConfigConfirmDialog = loadConfigConfirmOpen ? (
    <ConfirmDialog
      title="Load configuration"
      message="Replace all current playlists and taglists with the contents of trackvault.json? Indexed tracks are not affected."
      confirmLabel="Load"
      cancelLabel="Cancel"
      destructive
      busy={loadingConfig}
      onConfirm={() => void confirmLoadConfiguration()}
      onCancel={cancelLoadConfiguration}
    />
  ) : null;

  const resetConfirmDialog = resetConfirmOpen ? (
    <ConfirmDialog
      title="Reset to initial state"
      message="Clear the library folder, all indexed tracks, playlists, and taglists from the app? Audio files and trackvault.json on disk are not deleted."
      confirmLabel="Reset"
      cancelLabel="Cancel"
      destructive
      busy={resetting}
      onConfirm={() => void confirmResetLibrary()}
      onCancel={cancelResetLibrary}
    />
  ) : null;

  const fileOperationBusy =
    scanning || uploading || savingConfig || loadingConfig || resetting;
  const actionsDisabled = fileOperationBusy;
  const libraryActionsDisabled = fileOperationBusy || !libraryFolder;

  return {
    libraryFolder,
    scanning,
    uploading,
    savingConfig,
    loadingConfig,
    resetting,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    uploadConfirmDialog,
    loadConfigConfirmDialog,
    resetConfirmDialog,
    chooseLibraryFolder,
    uploadTracks,
    scanLibrary,
    saveConfiguration,
    requestLoadConfiguration,
    requestResetLibrary,
    actionsDisabled,
    libraryActionsDisabled,
  };
}
