import { useCallback, useState } from "react";

import {
  ERROR_DISMISS_MS,
  SUCCESS_DISMISS_MS,
  useAutoDismissFeedback,
} from "./useAutoDismissFeedback";
import { open, save } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { importCollectionFromDialog } from "../components/CollectionView";
import {
  PROJECT_ARCHIVE_DIALOG_FILTER,
  projectArchiveFileName,
} from "../lib/projectArchive";
import { DeliveryFolderPickerModal } from "../components/DeliveryFolderPickerModal";
import { DeliveryPreviewModal } from "../components/DeliveryPreviewModal";
import { useDeliveryFolderConfirm } from "./useDeliveryFolderConfirm";
import { ProjectHubModal } from "../components/ProjectHubModal";
import { PhoneUploadSettingsModal } from "../components/PhoneUploadSettingsModal";
import { UploadTracksModal } from "../components/UploadTracksModal";
import { usePhoneUploadSettings } from "./usePhoneUploadSettings";
import { getDeliveryCopy, normalizeApplicationId } from "../lib/applicationConfig";
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
  "Remove the current project library folder and clear all indexed tracks, project library playlists, and project library taglists from the app? Audio files on disk are not deleted. Stored collections are kept.\n\nSave configuration first if you want project library playlists and project library taglists written to trackvault.json.";

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
    uploadFromPaths: uploadLibraryFromPaths,
    uploading: libraryUploading,
    uploadMessage: libraryUploadMessage,
    uploadError: libraryUploadError,
    uploadConfirmDialog: libraryUploadConfirmDialog,
    clearUploadFeedback: clearLibraryUploadFeedback,
    showUploadMessage: showLibraryUploadMessage,
    showUploadError: showLibraryUploadError,
  } = libraryUpload;
  const {
    uploadFromPaths: uploadCollectionFromPaths,
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
  const [uploadModalTarget, setUploadModalTarget] = useState<
    "library" | "collection" | null
  >(null);
  const [projectHubOpen, setProjectHubOpen] = useState(false);
  const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreview | null>(null);
  const [exportingProject, setExportingProject] = useState(false);
  const [applyDeliveryPickerOpen, setApplyDeliveryPickerOpen] = useState(false);
  const [phoneUploadSettingsOpen, setPhoneUploadSettingsOpen] = useState(false);
  const { phoneUploadReady, reload: reloadPhoneUploadSettings } = usePhoneUploadSettings();

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
        const preview = await api.stageDelivery(
          [folder],
          activeProject.id,
          normalizeApplicationId(activeProject.application_id),
        );
        setDeliveryPreview(preview);
      } catch (err) {
        setConfigError(String(err));
      } finally {
        setDeliveryStaging(false);
      }
    },
    [activeProject, setConfigError, setDeliveryStaging],
  );

  const deliveryApplicationId = normalizeApplicationId(activeProject?.application_id);
  const deliveryCopy = getDeliveryCopy(deliveryApplicationId);

  const {
    pickAndShow: pickDeliveryFolderForUpdate,
    loadFolder: loadDeliveryFolderForUpdate,
    modal: deliveryFolderConfirmModal,
  } = useDeliveryFolderConfirm({
    applicationId: deliveryApplicationId,
    onConfirm: stageDeliveryFromFolder,
  });

  const closeApplyDeliveryPicker = useCallback(() => {
    setApplyDeliveryPickerOpen(false);
  }, []);

  const applyDeliveryUpdate = useCallback(() => {
    if (!activeProject) {
      setConfigError("Open a project first.");
      return;
    }
    setConfigError(null);
    setApplyDeliveryPickerOpen(true);
  }, [activeProject, setConfigError]);

  const chooseApplyDeliveryFolder = useCallback(() => {
    setApplyDeliveryPickerOpen(false);
    void pickDeliveryFolderForUpdate();
  }, [pickDeliveryFolderForUpdate]);

  const dropApplyDeliveryFolder = useCallback(
    (path: string) => {
      setApplyDeliveryPickerOpen(false);
      void loadDeliveryFolderForUpdate(path);
    },
    [loadDeliveryFolderForUpdate],
  );

  const exportProject = useCallback(async () => {
    if (!activeProject) {
      setConfigError("Open a project first.");
      return;
    }
    const destination = await save({
      title: "Export project",
      defaultPath: projectArchiveFileName(activeProject.name),
      filters: [PROJECT_ARCHIVE_DIALOG_FILTER],
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

  const chooseLibraryFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project library folder",
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
      setConfigMessage("Project library closed");
    }
  }, [closeLibrary]);

  const confirmSaveAndCloseLibrary = useCallback(async () => {
    const saved = await saveConfiguration();
    if (!saved) return;
    const closed = await closeLibrary();
    if (closed) {
      setConfigMessage("Saved and project library closed");
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
      setConfigMessage("Project library folder changed");
    }
  }, [applyLibraryFolder, pendingLibraryFolder]);

  const confirmSaveAndChangeLibrary = useCallback(async () => {
    if (pendingLibraryFolder == null) return;
    const saved = await saveConfiguration();
    if (!saved) return;
    const changed = await applyLibraryFolder(pendingLibraryFolder);
    if (changed) {
      setConfigMessage("Saved and project library folder changed");
    }
  }, [applyLibraryFolder, pendingLibraryFolder, saveConfiguration]);

  const openPhoneUploadSettings = useCallback(() => {
    setPhoneUploadSettingsOpen(true);
  }, []);

  const closePhoneUploadSettings = useCallback(() => {
    setPhoneUploadSettingsOpen(false);
  }, []);

  const openLibraryUpload = useCallback(() => {
    if (!libraryFolder) {
      showLibraryUploadError("Choose a project library folder before uploading tracks.");
      return;
    }
    clearUploadFeedback();
    setUploadModalTarget("library");
  }, [clearUploadFeedback, libraryFolder, showLibraryUploadError]);

  const openCollectionUpload = useCallback(() => {
    if (collectionId == null) {
      showCollectionUploadError("Open a stored collection before uploading tracks.");
      return;
    }
    clearUploadFeedback();
    setUploadModalTarget("collection");
  }, [clearUploadFeedback, collectionId, showCollectionUploadError]);

  const closeUploadModal = useCallback(() => {
    setUploadModalTarget(null);
  }, []);

  const handlePhoneUploadComplete = useCallback(
    (message: string) => {
      clearUploadFeedback();
      if (uploadModalTarget === "collection") {
        showCollectionUploadMessage(message);
      } else {
        showLibraryUploadMessage(message);
      }
      setUploadModalTarget(null);
    },
    [
      clearUploadFeedback,
      showCollectionUploadMessage,
      showLibraryUploadMessage,
      uploadModalTarget,
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
      message="Replace all current project library playlists and project library taglists with the contents of trackvault.json? Indexed tracks are not affected."
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
      title="Close project library?"
      message={CLOSE_LIBRARY_MESSAGE}
      confirmLabel="Close project library"
      secondaryLabel="Save & close project library"
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
      title="Change project library folder?"
      message={CLOSE_LIBRARY_MESSAGE}
      confirmLabel="Close project library"
      secondaryLabel="Save & close project library"
      cancelLabel="Cancel"
      destructive
      busy={scanning || closingLibrary || savingConfig}
      onConfirm={() => void confirmChangeLibrary()}
      onSecondary={() => void confirmSaveAndChangeLibrary()}
      onCancel={cancelChangeLibrary}
    />
  ) : null;

  const uploadModalOpen = uploadModalTarget != null;

  const projectHubModal = projectHubOpen ? (
    <ProjectHubModal onClose={closeProjectHub} />
  ) : null;

  const applyDeliveryPickerModal = applyDeliveryPickerOpen ? (
    <DeliveryFolderPickerModal
      title={deliveryCopy.applyUpdatePickerTitle}
      description={deliveryCopy.applyUpdateMenuTitle}
      chooseButtonLabel={deliveryCopy.applyUpdateChooseFolderButton}
      dropZoneLabel={deliveryCopy.applyUpdateDropZoneLabel}
      enabled={!deliveryStaging}
      onClose={closeApplyDeliveryPicker}
      onChooseFolder={chooseApplyDeliveryFolder}
      onFolderDropped={dropApplyDeliveryFolder}
    />
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
          setConfigMessage(getDeliveryCopy(activeProject.application_id).appliedSuccessMessage);
        }}
      />
    ) : null;

  const phoneUploadSettingsModal = phoneUploadSettingsOpen ? (
    <PhoneUploadSettingsModal
      onClose={closePhoneUploadSettings}
      onSaved={() => void reloadPhoneUploadSettings()}
    />
  ) : null;

  const coreFileOperationBusy =
    scanning ||
    deliveryStaging ||
    uploading ||
    savingConfig ||
    loadingConfig ||
    closingLibrary ||
    importingCollection ||
    exportingProject;
  const fileOperationBusy = coreFileOperationBusy || uploadModalOpen;
  const actionsDisabled = fileOperationBusy;
  const libraryActionsDisabled = fileOperationBusy || !libraryFolder;
  const libraryUploadDisabled = fileOperationBusy || !libraryFolder;
  const collectionUploadDisabled = fileOperationBusy || collectionId == null;
  const libraryUploadModalEnabled = !coreFileOperationBusy && !!libraryFolder;
  const collectionUploadModalEnabled =
    !coreFileOperationBusy && collectionId != null;

  const uploadTracksModal =
    uploadModalTarget === "library" ? (
      <UploadTracksModal
        mode="library"
        phoneUploadReady={phoneUploadReady}
        enabled={libraryUploadModalEnabled}
        uploading={libraryUploading}
        onClose={closeUploadModal}
        onUploadFromPaths={uploadLibraryFromPaths}
        onPhoneUploaded={handlePhoneUploadComplete}
      />
    ) : uploadModalTarget === "collection" && collectionId != null ? (
      <UploadTracksModal
        mode="collection"
        collectionId={collectionId}
        collectionName={collectionName}
        phoneUploadReady={phoneUploadReady}
        enabled={collectionUploadModalEnabled}
        uploading={collectionUploading}
        onClose={closeUploadModal}
        onUploadFromPaths={uploadCollectionFromPaths}
        onPhoneUploaded={handlePhoneUploadComplete}
      />
    ) : null;

  return {
    libraryFolder,
    activeProject,
    collectionId,
    collectionName,
    scanning,
    deliveryStaging,
    deliveryCopy,
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
    projectHubModal,
    applyDeliveryPickerModal,
    deliveryFolderConfirmModal,
    deliveryUpdateModal,
    openLibraryUpload,
    openCollectionUpload,
    phoneUploadReady,
    openPhoneUploadSettings,
    phoneUploadSettingsModal,
    uploadTracksModal,
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
