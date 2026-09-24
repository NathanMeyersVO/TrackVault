import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { AUDIO_FILE_DIALOG_FILTER } from "../lib/audioExtensions";
import { api } from "../lib/tauri";
import {
  formatCollectionConflictMessage,
  formatUploadResult,
} from "../lib/uploadFeedback";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

export function useCollectionUpload(collectionId: number | null) {
  const { refresh } = useLibrary();
  const { setScanning } = usePlayerStore();
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    sourcePaths: string[];
    conflicts: string[];
  } | null>(null);

  const runUpload = useCallback(
    async (sourcePaths: string[], overwrite: boolean) => {
      if (collectionId == null) return false;
      setUploading(true);
      setScanning(true);
      setUploadMessage(null);
      setUploadError(null);

      try {
        const result = await api.uploadCollectionTracks(
          collectionId,
          sourcePaths,
          overwrite,
        );
        await refresh();
        if (result.errors.length > 0 && result.uploaded === 0) {
          setUploadError(formatUploadResult(result));
          return false;
        }
        setUploadMessage(formatUploadResult(result));
        return true;
      } catch (error) {
        setUploadError(String(error));
        return false;
      } finally {
        setUploading(false);
        setScanning(false);
      }
    },
    [collectionId, refresh, setScanning],
  );

  const uploadFromPaths = useCallback(
    async (sourcePaths: string[]) => {
      if (collectionId == null) {
        setUploadError("Open a stored collection before uploading tracks.");
        setUploadMessage(null);
        return false;
      }
      if (sourcePaths.length === 0) return false;

      try {
        const conflicts = await api.checkCollectionUploadConflicts(
          collectionId,
          sourcePaths,
        );
        if (conflicts.length > 0) {
          setPendingUpload({ sourcePaths, conflicts });
          return false;
        }
        return await runUpload(sourcePaths, false);
      } catch (error) {
        setUploadError(String(error));
        return false;
      }
    },
    [collectionId, runUpload],
  );

  const uploadTracks = useCallback(async () => {
    const selected = await open({
      multiple: true,
      title: "Choose audio files to upload",
      filters: [AUDIO_FILE_DIALOG_FILTER],
    });

    if (selected == null) return false;

    const sourcePaths = Array.isArray(selected) ? selected : [selected];
    return uploadFromPaths(sourcePaths);
  }, [uploadFromPaths]);

  const cancelPendingUpload = useCallback(() => {
    if (uploading) return;
    setPendingUpload(null);
  }, [uploading]);

  const confirmOverwriteUpload = useCallback(async () => {
    if (!pendingUpload) return false;
    const { sourcePaths } = pendingUpload;
    setPendingUpload(null);
    return runUpload(sourcePaths, true);
  }, [pendingUpload, runUpload]);

  const confirmKeepBothUpload = useCallback(async () => {
    if (!pendingUpload) return false;
    const { sourcePaths } = pendingUpload;
    setPendingUpload(null);
    return runUpload(sourcePaths, false);
  }, [pendingUpload, runUpload]);

  const uploadConfirmDialog = pendingUpload ? (
    <ConfirmDialog
      title="Replace existing files?"
      message={formatCollectionConflictMessage(pendingUpload.conflicts)}
      confirmLabel="Overwrite"
      secondaryLabel="Keep both"
      cancelLabel="Cancel"
      destructive
      busy={uploading}
      onConfirm={() => void confirmOverwriteUpload()}
      onSecondary={() => void confirmKeepBothUpload()}
      onCancel={cancelPendingUpload}
    />
  ) : null;

  return {
    uploadTracks,
    uploadFromPaths,
    uploading,
    uploadMessage,
    uploadError,
    uploadConfirmDialog,
    clearUploadFeedback: useCallback(() => {
      setUploadMessage(null);
      setUploadError(null);
    }, []),
    showUploadMessage: useCallback((message: string) => {
      setUploadMessage(message);
      setUploadError(null);
    }, []),
    showUploadError: useCallback((message: string) => {
      setUploadError(message);
      setUploadMessage(null);
    }, []),
  };
}
