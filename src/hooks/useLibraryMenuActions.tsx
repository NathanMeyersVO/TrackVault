import { useCallback, useState } from "react";

import {
  ERROR_DISMISS_MS,
  SUCCESS_DISMISS_MS,
  useAutoDismissFeedback,
} from "./useAutoDismissFeedback";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { importCollectionFromDialog } from "../components/CollectionView";
import { api, type PlaybackState } from "../lib/tauri";
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

const CLOSE_LIBRARY_MESSAGE =
  "Remove the current library folder and clear all indexed tracks, library playlists, and library taglists from the app? Audio files on disk are not deleted. Stored collections are kept.\n\nSave configuration first if you want library playlists and library taglists written to trackvault.json.";

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
  const clearConfigFeedback = useCallback(() => {
    setConfigMessage(null);
    setConfigError(null);
  }, []);
  const dismissStatusFeedback = useCallback(() => {
    clearUploadFeedback();
    clearConfigFeedback();
  }, [clearConfigFeedback, clearUploadFeedback]);
  const statusError = uploadError ?? configError;
  const statusSuccess = uploadMessage ?? configMessage;
  useAutoDismissFeedback(statusError, dismissStatusFeedback, ERROR_DISMISS_MS);
  useAutoDismissFeedback(
    statusError == null ? statusSuccess : null,
    dismissStatusFeedback,
    SUCCESS_DISMISS_MS,
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadConfigConfirmOpen, setLoadConfigConfirmOpen] = useState(false);
  const [closingLibrary, setClosingLibrary] = useState(false);
  const [closeLibraryConfirmOpen, setCloseLibraryConfirmOpen] = useState(false);
  const [changeLibraryConfirmOpen, setChangeLibraryConfirmOpen] = useState(false);
  const [pendingLibraryFolder, setPendingLibraryFolder] = useState<string | null>(null);
  const [importingCollection, setImportingCollection] = useState(false);

  const resetLibraryFrontend = useCallback(
    (playback: PlaybackState) => {
      setPlayback(playback);
      if (view === "library") {
        setCursorTrackId(null);
        setActiveTrackIds([]);
      }
      clearPendingPausedLoad();
      clearTrackTagsCache();
    },
    [
      clearPendingPausedLoad,
      setActiveTrackIds,
      setCursorTrackId,
      setPlayback,
      view,
    ],
  );

  const applyLibraryFolder = useCallback(
    async (path: string) => {
      setScanning(true);
      setConfigError(null);
      setConfigMessage(null);
      clearUploadFeedback();
      try {
        if (libraryFolder) {
          const playback = await api.closeLibrary();
          resetLibraryFrontend(playback);
        }
        await api.setLibraryFolder(path);
        await refresh();
        setChangeLibraryConfirmOpen(false);
        setPendingLibraryFolder(null);
        return true;
      } catch (err) {
        setConfigError(String(err));
        await refresh().catch(console.error);
        return false;
      } finally {
        setScanning(false);
      }
    },
    [clearUploadFeedback, libraryFolder, refresh, resetLibraryFrontend, setScanning],
  );

  const chooseLibraryFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose library folder",
    });
    if (typeof selected !== "string") return;
    if (selected === libraryFolder) return;

    if (!libraryFolder) {
      await applyLibraryFolder(selected);
      return;
    }

    setPendingLibraryFolder(selected);
    setChangeLibraryConfirmOpen(true);
  }, [applyLibraryFolder, libraryFolder]);

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
      resetLibraryFrontend(playback);
      await refresh();
      setCloseLibraryConfirmOpen(false);
      return true;
    } catch (err) {
      setConfigError(String(err));
      return false;
    } finally {
      setClosingLibrary(false);
    }
  }, [clearUploadFeedback, refresh, resetLibraryFrontend]);

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

  const cancelChangeLibrary = useCallback(() => {
    if (scanning || closingLibrary || savingConfig) return;
    setChangeLibraryConfirmOpen(false);
    setPendingLibraryFolder(null);
  }, [closingLibrary, savingConfig, scanning]);

  const confirmChangeLibrary = useCallback(async () => {
    if (pendingLibraryFolder == null) return;
    const changed = await applyLibraryFolder(pendingLibraryFolder);
    if (changed) {
      setConfigMessage("Library folder changed");
    }
  }, [applyLibraryFolder, pendingLibraryFolder]);

  const confirmSaveAndChangeLibrary = useCallback(async () => {
    if (pendingLibraryFolder == null) return;
    const saved = await saveConfiguration();
    if (!saved) return;
    const changed = await applyLibraryFolder(pendingLibraryFolder);
    if (changed) {
      setConfigMessage("Saved and library folder changed");
    }
  }, [applyLibraryFolder, pendingLibraryFolder, saveConfiguration]);

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
      setConfigMessage("Stored collection imported");
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setImportingCollection(false);
    }
  }, [clearUploadFeedback, refresh, setView]);

  const loadConfigConfirmDialog = loadConfigConfirmOpen ? (
    <ConfirmDialog
      title="Load configuration"
      message="Replace all current library playlists and library taglists with the contents of trackvault.json? Indexed tracks are not affected."
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
      message={CLOSE_LIBRARY_MESSAGE}
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

  const changeLibraryConfirmDialog = changeLibraryConfirmOpen ? (
    <ConfirmDialog
      title="Change library folder?"
      message={CLOSE_LIBRARY_MESSAGE}
      confirmLabel="Close library"
      secondaryLabel="Save & close library"
      cancelLabel="Cancel"
      destructive
      busy={scanning || closingLibrary || savingConfig}
      onConfirm={() => void confirmChangeLibrary()}
      onSecondary={() => void confirmSaveAndChangeLibrary()}
      onCancel={cancelChangeLibrary}
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
  };
}
