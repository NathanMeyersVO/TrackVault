import { useCallback, useState } from "react";

import {
  ERROR_DISMISS_MS,
  SUCCESS_DISMISS_MS,
  useAutoDismissFeedback,
} from "./useAutoDismissFeedback";
import { open, save } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { importCollectionFromDialog } from "../components/CollectionView";
import { DeliveryPreviewModal } from "../components/DeliveryPreviewModal";
import { useDeliveryFolderConfirm } from "./useDeliveryFolderConfirm";
import { ProjectHubModal } from "../components/ProjectHubModal";
import { RemoteImportFromPhoneModal } from "../components/RemoteImportFromPhoneModal";
import { api, type DeliveryPreview } from "../lib/tauri";
import { useLibrary } from "./usePlayer";
import { useLibraryUiReset } from "./useLibraryUiReset";
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
    activeProject,
    scanning,
    deliveryStaging,
    view,
    collections,
    setScanning,
    setDeliveryStaging,
    setView,
  } = usePlayerStore();
  const { resetLibraryUi } = useLibraryUiReset();
  const collectionId = activeCollectionId(view);
  const collectionName =
    collectionId != null
      ? collections.find((collection) => collection.id === collectionId)?.name
      : null;
  const { refresh } = useLibrary();
  const libraryUpload = useUploadTracks();
  const collectionUpload = useCollectionUpload(collectionId);
  const {
    uploadTracks: uploadToLibrary,
    uploading: libraryUploading,
    uploadMessage: libraryUploadMessage,
    uploadError: libraryUploadError,
    uploadConfirmDialog: libraryUploadConfirmDialog,
    clearUploadFeedback: clearLibraryUploadFeedback,
    showUploadMessage: showLibraryUploadMessage,
    showUploadError: showLibraryUploadError,
  } = libraryUpload;
  const {
    uploadTracks: uploadToCollection,
    uploading: collectionUploading,
    uploadMessage: collectionUploadMessage,
    uploadError: collectionUploadError,
    uploadConfirmDialog: collectionUploadConfirmDialog,
    clearUploadFeedback: clearCollectionUploadFeedback,
    showUploadMessage: showCollectionUploadMessage,
    showUploadError: showCollectionUploadError,
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
  const [remoteImportMode, setRemoteImportMode] = useState<
    "library" | "collection" | null
  >(null);
  const [projectHubOpen, setProjectHubOpen] = useState(false);
  const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreview | null>(null);
  const [refreshingSchedule, setRefreshingSchedule] = useState(false);
  const [exportingProject, setExportingProject] = useState(false);

  const applyLibraryFolder = useCallback(
    async (path: string) => {
      setScanning(true);
      setConfigError(null);
      setConfigMessage(null);
      clearUploadFeedback();
      try {
        if (libraryFolder) {
          const playback = await api.closeLibrary();
          resetLibraryUi(playback);
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
    [clearUploadFeedback, libraryFolder, refresh, resetLibraryUi, setScanning],
  );

  const openProjectHub = useCallback(() => {
    setProjectHubOpen(true);
  }, []);

  const closeProjectHub = useCallback(() => {
    setProjectHubOpen(false);
  }, []);

  const stageDeliveryFromFolder = useCallback(
    async (folder: string) => {
      if (!activeProject) return;
      setDeliveryStaging(true);
      setConfigError(null);
      try {
        const preview = await api.stageDelivery([folder], activeProject.id);
        setDeliveryPreview(preview);
      } catch (err) {
        setConfigError(String(err));
      } finally {
        setDeliveryStaging(false);
      }
    },
    [activeProject, setConfigError, setDeliveryStaging],
  );

  const {
    pickAndShow: pickDeliveryFolderForUpdate,
    modal: deliveryFolderConfirmModal,
  } = useDeliveryFolderConfirm({ onConfirm: stageDeliveryFromFolder });

  const applyDeliveryUpdate = useCallback(() => {
    if (!activeProject) {
      setConfigError("Open a project first.");
      return;
    }
    setConfigError(null);
    void pickDeliveryFolderForUpdate();
  }, [activeProject, pickDeliveryFolderForUpdate, setConfigError]);

  const exportProject = useCallback(async () => {
    if (!activeProject) {
      setConfigError("Open a project first.");
      return;
    }
    const safeName = activeProject.name.replace(/[^\w\s-]+/g, "").trim() || "project";
    const destination = await save({
      title: "Export project",
      defaultPath: `${safeName}.tgz`,
      filters: [{ name: "TrackVault project archive", extensions: ["tgz"] }],
    });
    if (destination == null) return;

    setExportingProject(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      await api.exportProject(activeProject.id, destination);
      setConfigMessage(`Exported project to ${destination}`);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setExportingProject(false);
    }
  }, [activeProject, clearUploadFeedback]);

  const refreshProjectSchedule = useCallback(async () => {
    setRefreshingSchedule(true);
    setConfigError(null);
    try {
      const count = await api.refreshProjectSchedule();
      await refresh();
      setConfigMessage(`Refreshed ${count} event titles from schedule`);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setRefreshingSchedule(false);
    }
  }, [refresh]);

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
      resetLibraryUi(playback);
      await refresh();
      setCloseLibraryConfirmOpen(false);
      return true;
    } catch (err) {
      setConfigError(String(err));
      return false;
    } finally {
      setClosingLibrary(false);
    }
  }, [clearUploadFeedback, refresh, resetLibraryUi]);

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

  const openLibraryRemoteUpload = useCallback(() => {
    if (!libraryFolder) {
      showLibraryUploadError("Choose a library folder before uploading tracks.");
      return;
    }
    clearUploadFeedback();
    setRemoteImportMode("library");
  }, [clearUploadFeedback, libraryFolder, showLibraryUploadError]);

  const openCollectionRemoteUpload = useCallback(() => {
    if (collectionId == null) {
      showCollectionUploadError("Open a stored collection before uploading tracks.");
      return;
    }
    clearUploadFeedback();
    setRemoteImportMode("collection");
  }, [clearUploadFeedback, collectionId, showCollectionUploadError]);

  const closeRemoteImport = useCallback(() => {
    setRemoteImportMode(null);
  }, []);

  const handleRemoteImportUploaded = useCallback(
    (message: string) => {
      clearUploadFeedback();
      if (remoteImportMode === "collection") {
        showCollectionUploadMessage(message);
      } else {
        showLibraryUploadMessage(message);
      }
      setRemoteImportMode(null);
    },
    [
      clearUploadFeedback,
      remoteImportMode,
      showCollectionUploadMessage,
      showLibraryUploadMessage,
    ],
  );

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

  const remoteImportOpen = remoteImportMode != null;

  const projectHubModal = projectHubOpen ? (
    <ProjectHubModal onClose={closeProjectHub} />
  ) : null;

  const deliveryUpdateModal =
    deliveryPreview && activeProject ? (
      <DeliveryPreviewModal
        preview={deliveryPreview}
        mode="update"
        projectName={activeProject.name}
        applicationId={activeProject.application_id}
        onClose={() => setDeliveryPreview(null)}
        onApplied={async () => {
          setDeliveryPreview(null);
          await refresh();
          setConfigMessage("Delivery update applied");
        }}
      />
    ) : null;

  const remoteImportModal =
    remoteImportMode === "library" ? (
      <RemoteImportFromPhoneModal
        mode="library"
        onClose={closeRemoteImport}
        onUploaded={handleRemoteImportUploaded}
      />
    ) : remoteImportMode === "collection" && collectionId != null ? (
      <RemoteImportFromPhoneModal
        mode="collection"
        collectionId={collectionId}
        collectionName={collectionName}
        onClose={closeRemoteImport}
        onUploaded={handleRemoteImportUploaded}
      />
    ) : null;

  const fileOperationBusy =
    scanning ||
    deliveryStaging ||
    uploading ||
    savingConfig ||
    loadingConfig ||
    closingLibrary ||
    importingCollection ||
    exportingProject ||
    remoteImportOpen;
  const actionsDisabled = fileOperationBusy;
  const libraryActionsDisabled = fileOperationBusy || !libraryFolder;
  const libraryUploadDisabled = fileOperationBusy || !libraryFolder;
  const collectionUploadDisabled = fileOperationBusy || collectionId == null;

  return {
    libraryFolder,
    activeProject,
    collectionId,
    collectionName,
    scanning,
    deliveryStaging,
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
    openProjectHub,
    applyDeliveryUpdate,
    refreshProjectSchedule,
    refreshingSchedule,
    projectHubModal,
    deliveryFolderConfirmModal,
    deliveryUpdateModal,
    uploadToLibrary,
    uploadToCollection,
    openLibraryRemoteUpload,
    openCollectionRemoteUpload,
    remoteImportModal,
    exportProject,
    exportingProject,
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
