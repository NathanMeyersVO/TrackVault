import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { api } from "../lib/tauri";
import {
  formatCollectionConflictMessage,
  formatUploadResult,
} from "../lib/uploadFeedback";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "mp4", "aiff"];

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
      if (collectionId == null) return;
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
        } else {
          setUploadMessage(formatUploadResult(result));
        }
      } catch (error) {
        setUploadError(String(error));
      } finally {
        setUploading(false);
        setScanning(false);
      }
    },
    [collectionId, refresh, setScanning],
  );

  const uploadTracks = useCallback(async () => {
    if (collectionId == null) {
      setUploadError("Open a stored collection before uploading tracks.");
      setUploadMessage(null);
      return;
    }

    const selected = await open({
      multiple: true,
      title: "Choose audio files to upload",
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });

    if (selected == null) return;

    const sourcePaths = Array.isArray(selected) ? selected : [selected];
    if (sourcePaths.length === 0) return;

    try {
      const conflicts = await api.checkCollectionUploadConflicts(
        collectionId,
        sourcePaths,
      );
      if (conflicts.length > 0) {
        setPendingUpload({ sourcePaths, conflicts });
        return;
      }
      await runUpload(sourcePaths, false);
    } catch (error) {
      setUploadError(String(error));
    }
  }, [collectionId, runUpload]);

  const cancelPendingUpload = useCallback(() => {
    if (uploading) return;
    setPendingUpload(null);
  }, [uploading]);

  const confirmOverwriteUpload = useCallback(async () => {
    if (!pendingUpload) return;
    const { sourcePaths } = pendingUpload;
    setPendingUpload(null);
    await runUpload(sourcePaths, true);
  }, [pendingUpload, runUpload]);

  const confirmKeepBothUpload = useCallback(async () => {
    if (!pendingUpload) return;
    const { sourcePaths } = pendingUpload;
    setPendingUpload(null);
    await runUpload(sourcePaths, false);
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
