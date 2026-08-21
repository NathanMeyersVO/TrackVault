import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { importCollectionFromDialog } from "../components/CollectionView";
import { api } from "../lib/tauri";
import { clearTrackTagsCache } from "../lib/trackTagsCache";
import { useLibrary } from "./usePlayer";
import { useUploadTracks } from "./useUploadTracks";
import { useCollectionUpload } from "./useCollectionUpload";
import { usePlayerStore } from "../store/playerStore";

function activeCollectionId(
  view: ReturnType<typeof usePlayerStore.getState>["view"],
): number | null {
  if (typeof view === "object" && "collectionId" in view) {
    return view.collectionId;
  }
  return null;
}

export function useLibraryMenuActions() {
  const {
    libraryFolder,
    scanning,
    view,
    collections,
    setScanning,
    setView,
    setCursorTrackId,
    setActiveTrackIds,
    setPlayback,
    clearPendingPausedLoad,
  } = usePlayerStore();
  const collectionId = activeCollectionId(view);
  const collectionName =
    collectionId != null
      ? collections.find((collection) => collection.id === collectionId)?.name
      : null;
  const { refresh, scanLibrary } = useLibrary();
  const libraryUpload = useUploadTracks();
  const collectionUpload = useCollectionUpload(collectionId);
  const {
    uploadTracks: uploadToLibrary,
    uploading: libraryUploading,
    uploadMessage: libraryUploadMessage,
    uploadError: libraryUploadError,
    uploadConfirmDialog: libraryUploadConfirmDialog,
    clearUploadFeedback: clearLibraryUploadFeedback,
  } = libraryUpload;
  const {
    uploadTracks: uploadToCollection,
    uploading: collectionUploading,
    uploadMessage: collectionUploadMessage,
    uploadError: collectionUploadError,
    uploadConfirmDialog: collectionUploadConfirmDialog,
    clearUploadFeedback: clearCollectionUploadFeedback,
  } = collectionUpload;
  const uploading = libraryUploading || collectionUploading;
  const uploadMessage = libraryUploadMessage ?? collectionUploadMessage;
  const uploadError = libraryUploadError ?? collectionUploadError;
  const clearUploadFeedback = useCallback(() => {
    clearLibraryUploadFeedback();
    clearCollectionUploadFeedback();
  }, [clearCollectionUploadFeedback, clearLibraryUploadFeedback]);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadConfigConfirmOpen, setLoadConfigConfirmOpen] = useState(false);
  const [closingLibrary, setClosingLibrary] = useState(false);
  const [closeLibraryConfirmOpen, setCloseLibraryConfirmOpen] = useState(false);
  const [importingCollection, setImportingCollection] = useState(false);

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
      return true;
    } catch (err) {
      setConfigError(String(err));
      return false;
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

  const closeLibrary = useCallback(async () => {
    setClosingLibrary(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const playback = await api.closeLibrary();
      setPlayback(playback);
      if (view === "library") {
        setCursorTrackId(null);
        setActiveTrackIds([]);
      }
      clearPendingPausedLoad();
      clearTrackTagsCache();
      await refresh();
      setCloseLibraryConfirmOpen(false);
      return true;
    } catch (err) {
      setConfigError(String(err));
      return false;
    } finally {
      setClosingLibrary(false);
    }
  }, [
    clearPendingPausedLoad,
    clearUploadFeedback,
    refresh,
    setActiveTrackIds,
    setCursorTrackId,
    setPlayback,
    view,
  ]);

  const requestCloseLibrary = useCallback(() => {
    setCloseLibraryConfirmOpen(true);
  }, []);

  const cancelCloseLibrary = useCallback(() => {
    if (closingLibrary || savingConfig) return;
    setCloseLibraryConfirmOpen(false);
  }, [closingLibrary, savingConfig]);

  const confirmCloseLibrary = useCallback(async () => {
    const closed = await closeLibrary();
    if (closed) {
      setConfigMessage("Library closed");
    }
  }, [closeLibrary]);

  const confirmSaveAndCloseLibrary = useCallback(async () => {
    const saved = await saveConfiguration();
    if (!saved) return;
    const closed = await closeLibrary();
    if (closed) {
      setConfigMessage("Saved and library closed");
    }
  }, [closeLibrary, saveConfiguration]);

  const importCollection = useCallback(async () => {
    setImportingCollection(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const collectionId = await importCollectionFromDialog();
      if (collectionId == null) return;
      await refresh();
      setView({ collectionId });
      setConfigMessage("Collection imported");
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setImportingCollection(false);
    }
  }, [clearUploadFeedback, refresh, setView]);

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

  const closeLibraryConfirmDialog = closeLibraryConfirmOpen ? (
    <ConfirmDialog
      title="Close library?"
      message={
        "Remove the current library folder and clear all indexed tracks, playlists, and taglists from the app? Audio files on disk are not deleted. Collections are kept.\n\nSave configuration first if you want playlists and taglists written to trackvault.json."
      }
      confirmLabel="Close library"
      secondaryLabel="Save & close library"
      cancelLabel="Cancel"
      destructive
      busy={closingLibrary || savingConfig}
      onConfirm={() => void confirmCloseLibrary()}
      onSecondary={() => void confirmSaveAndCloseLibrary()}
      onCancel={cancelCloseLibrary}
    />
  ) : null;

  const fileOperationBusy =
    scanning ||
    uploading ||
    savingConfig ||
    loadingConfig ||
    closingLibrary ||
    importingCollection;
  const actionsDisabled = fileOperationBusy;
  const libraryActionsDisabled = fileOperationBusy || !libraryFolder;
  const libraryUploadDisabled = fileOperationBusy || !libraryFolder;
  const collectionUploadDisabled = fileOperationBusy || collectionId == null;

  return {
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
  };
}
