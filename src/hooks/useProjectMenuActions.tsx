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
import { useProject } from "./usePlayer";
import { useProjectUiReset } from "./useProjectUiReset";
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
  "Remove the current project folder and clear all indexed tracks, project playlists, and project taglists from the app? Audio files on disk are not deleted. Stored collections are kept.\n\nSave configuration first if you want project playlists and project taglists written to trackvault.json.";

export function useProjectMenuActions() {
  const {
    projectFolder,
    activeProject,
    scanning,
    deliveryStaging,
    view,
    collections,
    setScanning,
    setDeliveryStaging,
    setView,
  } = usePlayerStore();
  const { resetProjectUi } = useProjectUiReset();
  const collectionId = activeCollectionId(view);
  const collectionName =
    collectionId != null
      ? collections.find((collection) => collection.id === collectionId)?.name
      : null;
  const { refresh } = useProject();
  const projectUpload = useUploadTracks();
  const collectionUpload = useCollectionUpload(collectionId);
  const {
    uploadFromPaths: uploadProjectFromPaths,
    uploading: projectUploading,
    uploadMessage: projectUploadMessage,
    uploadError: projectUploadError,
    uploadConfirmDialog: projectUploadConfirmDialog,
    clearUploadFeedback: clearProjectUploadFeedback,
    showUploadMessage: showProjectUploadMessage,
    showUploadError: showProjectUploadError,
  } = projectUpload;
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
  const uploading = projectUploading || collectionUploading;
  const uploadMessage = projectUploadMessage ?? collectionUploadMessage;
  const uploadError = projectUploadError ?? collectionUploadError;
  const clearUploadFeedback = useCallback(() => {
    clearProjectUploadFeedback();
    clearCollectionUploadFeedback();
  }, [clearCollectionUploadFeedback, clearProjectUploadFeedback]);
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
  const [closingProject, setClosingProject] = useState(false);
  const [closeProjectConfirmOpen, setCloseProjectConfirmOpen] = useState(false);
  const [changeProjectConfirmOpen, setChangeProjectConfirmOpen] = useState(false);
  const [pendingProjectFolder, setPendingProjectFolder] = useState<string | null>(null);
  const [importingCollection, setImportingCollection] = useState(false);
  const [uploadModalTarget, setUploadModalTarget] = useState<
    "project" | "collection" | null
  >(null);
  const [projectHubOpen, setProjectHubOpen] = useState(false);
  const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreview | null>(null);
  const [exportingProject, setExportingProject] = useState(false);
  const [applyDeliveryPickerOpen, setApplyDeliveryPickerOpen] = useState(false);
  const [phoneUploadSettingsOpen, setPhoneUploadSettingsOpen] = useState(false);
  const { phoneUploadReady, reload: reloadPhoneUploadSettings } = usePhoneUploadSettings();

  const applyProjectFolder = useCallback(
    async (path: string) => {
      setScanning(true);
      setConfigError(null);
      setConfigMessage(null);
      clearUploadFeedback();
      try {
        if (projectFolder) {
          const playback = await api.closeProject();
          resetProjectUi(playback);
        }
        await api.setProjectFolder(path);
        await refresh();
        setChangeProjectConfirmOpen(false);
        setPendingProjectFolder(null);
        return true;
      } catch (err) {
        setConfigError(String(err));
        await refresh().catch(console.error);
        return false;
      } finally {
        setScanning(false);
      }
    },
    [clearUploadFeedback, projectFolder, refresh, resetProjectUi, setScanning],
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

  const chooseProjectFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder",
    });
    if (typeof selected !== "string") return;
    if (selected === projectFolder) return;

    if (!projectFolder) {
      await applyProjectFolder(selected);
      return;
    }

    setPendingProjectFolder(selected);
    setChangeProjectConfirmOpen(true);
  }, [applyProjectFolder, projectFolder]);

  const saveConfiguration = useCallback(async () => {
    setSavingConfig(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const savedPath = await api.saveProjectConfig();
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
    if (!projectFolder) return;
    setLoadConfigConfirmOpen(true);
  }, [projectFolder]);

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
      const loadedPath = await api.loadProjectConfig();
      await refresh();
      setConfigMessage(`Loaded from ${loadedPath}`);
      setLoadConfigConfirmOpen(false);
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, [clearUploadFeedback, refresh]);

  const closeProject = useCallback(async () => {
    setClosingProject(true);
    setConfigMessage(null);
    setConfigError(null);
    clearUploadFeedback();
    try {
      const playback = await api.closeProject();
      resetProjectUi(playback);
      await refresh();
      setCloseProjectConfirmOpen(false);
      return true;
    } catch (err) {
      setConfigError(String(err));
      return false;
    } finally {
      setClosingProject(false);
    }
  }, [clearUploadFeedback, refresh, resetProjectUi]);

  const requestCloseProject = useCallback(() => {
    setCloseProjectConfirmOpen(true);
  }, []);

  const cancelCloseProject = useCallback(() => {
    if (closingProject || savingConfig) return;
    setCloseProjectConfirmOpen(false);
  }, [closingProject, savingConfig]);

  const confirmCloseProject = useCallback(async () => {
    const closed = await closeProject();
    if (closed) {
      setConfigMessage("Project closed");
    }
  }, [closeProject]);

  const confirmSaveAndCloseProject = useCallback(async () => {
    const saved = await saveConfiguration();
    if (!saved) return;
    const closed = await closeProject();
    if (closed) {
      setConfigMessage("Saved and project closed");
    }
  }, [closeProject, saveConfiguration]);

  const cancelChangeProject = useCallback(() => {
    if (scanning || closingProject || savingConfig) return;
    setChangeProjectConfirmOpen(false);
    setPendingProjectFolder(null);
  }, [closingProject, savingConfig, scanning]);

  const confirmChangeProject = useCallback(async () => {
    if (pendingProjectFolder == null) return;
    const changed = await applyProjectFolder(pendingProjectFolder);
    if (changed) {
      setConfigMessage("Project folder changed");
    }
  }, [applyProjectFolder, pendingProjectFolder]);

  const confirmSaveAndChangeProject = useCallback(async () => {
    if (pendingProjectFolder == null) return;
    const saved = await saveConfiguration();
    if (!saved) return;
    const changed = await applyProjectFolder(pendingProjectFolder);
    if (changed) {
      setConfigMessage("Saved and project folder changed");
    }
  }, [applyProjectFolder, pendingProjectFolder, saveConfiguration]);

  const openPhoneUploadSettings = useCallback(() => {
    setPhoneUploadSettingsOpen(true);
  }, []);

  const closePhoneUploadSettings = useCallback(() => {
    setPhoneUploadSettingsOpen(false);
  }, []);

  const openProjectUpload = useCallback(() => {
    if (!projectFolder) {
      showProjectUploadError("Choose a project folder before uploading tracks.");
      return;
    }
    clearUploadFeedback();
    setUploadModalTarget("project");
  }, [clearUploadFeedback, projectFolder, showProjectUploadError]);

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
        showProjectUploadMessage(message);
      }
      setUploadModalTarget(null);
    },
    [
      clearUploadFeedback,
      showCollectionUploadMessage,
      showProjectUploadMessage,
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
      message="Replace all current project playlists and project taglists with the contents of trackvault.json? Indexed tracks are not affected."
      confirmLabel="Load"
      cancelLabel="Cancel"
      destructive
      busy={loadingConfig}
      onConfirm={() => void confirmLoadConfiguration()}
      onCancel={cancelLoadConfiguration}
    />
  ) : null;

  const closeProjectConfirmDialog = closeProjectConfirmOpen ? (
    <ConfirmDialog
      title="Close project?"
      message={CLOSE_LIBRARY_MESSAGE}
      confirmLabel="Close project"
      secondaryLabel="Save & close project"
      cancelLabel="Cancel"
      destructive
      busy={closingProject || savingConfig}
      onConfirm={() => void confirmCloseProject()}
      onSecondary={() => void confirmSaveAndCloseProject()}
      onCancel={cancelCloseProject}
    />
  ) : null;

  const changeProjectConfirmDialog = changeProjectConfirmOpen ? (
    <ConfirmDialog
      title="Change project folder?"
      message={CLOSE_LIBRARY_MESSAGE}
      confirmLabel="Close project"
      secondaryLabel="Save & close project"
      cancelLabel="Cancel"
      destructive
      busy={scanning || closingProject || savingConfig}
      onConfirm={() => void confirmChangeProject()}
      onSecondary={() => void confirmSaveAndChangeProject()}
      onCancel={cancelChangeProject}
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
    closingProject ||
    importingCollection ||
    exportingProject;
  const fileOperationBusy = coreFileOperationBusy || uploadModalOpen;
  const actionsDisabled = fileOperationBusy;
  const projectActionsDisabled = fileOperationBusy || !projectFolder;
  const projectUploadDisabled = fileOperationBusy || !projectFolder;
  const collectionUploadDisabled = fileOperationBusy || collectionId == null;
  const projectUploadModalEnabled = !coreFileOperationBusy && !!projectFolder;
  const collectionUploadModalEnabled =
    !coreFileOperationBusy && collectionId != null;

  const uploadTracksModal =
    uploadModalTarget === "project" ? (
      <UploadTracksModal
        mode="project"
        phoneUploadReady={phoneUploadReady}
        enabled={projectUploadModalEnabled}
        uploading={projectUploading}
        onClose={closeUploadModal}
        onUploadFromPaths={uploadProjectFromPaths}
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
    projectFolder,
    activeProject,
    collectionId,
    collectionName,
    scanning,
    deliveryStaging,
    deliveryCopy,
    projectUploading,
    collectionUploading,
    savingConfig,
    loadingConfig,
    closingProject,
    importingCollection,
    uploadMessage,
    uploadError,
    configMessage,
    configError,
    dismissStatusFeedback,
    projectUploadConfirmDialog,
    collectionUploadConfirmDialog,
    loadConfigConfirmDialog,
    closeProjectConfirmDialog,
    changeProjectConfirmDialog,
    chooseProjectFolder,
    openProjectHub,
    applyDeliveryUpdate,
    projectHubModal,
    applyDeliveryPickerModal,
    deliveryFolderConfirmModal,
    deliveryUpdateModal,
    openProjectUpload,
    openCollectionUpload,
    phoneUploadReady,
    openPhoneUploadSettings,
    phoneUploadSettingsModal,
    uploadTracksModal,
    exportProject,
    exportingProject,
    saveConfiguration,
    requestLoadConfiguration,
    requestCloseProject,
    importCollection,
    actionsDisabled,
    projectActionsDisabled,
    projectUploadDisabled,
    collectionUploadDisabled,
  };
}
