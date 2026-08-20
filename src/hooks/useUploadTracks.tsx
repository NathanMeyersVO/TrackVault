import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { api, type UploadResult } from "../lib/tauri";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "mp4", "aiff"];

function formatUploadResult(result: UploadResult): string {
  if (result.uploaded === 0 && result.errors.length === 0) {
    return "No tracks were uploaded.";
  }

  const parts: string[] = [];
  if (result.uploaded > 0) {
    parts.push(
      `Uploaded ${result.uploaded} track${result.uploaded === 1 ? "" : "s"}`,
    );
  }
  if (result.skipped > 0) {
    parts.push(
      `Skipped ${result.skipped} file${result.skipped === 1 ? "" : "s"}`,
    );
  }
  if (result.errors.length > 0) {
    parts.push(result.errors[0]);
  }
  return parts.join(". ");
}

function formatConflictMessage(conflicts: string[]): string {
  const preview = conflicts.slice(0, 5).join("\n");
  const remaining = conflicts.length - 5;
  const suffix = remaining > 0 ? `\n…and ${remaining} more.` : "";
  return `These files already exist in UPLOADED:\n${preview}${suffix}\n\nOverwrite the existing files, or keep both copies?`;
}

export function useUploadTracks() {
  const { refresh } = useLibrary();
  const { libraryFolder, setScanning } = usePlayerStore();
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    sourcePaths: string[];
    conflicts: string[];
  } | null>(null);

  const runUpload = useCallback(
    async (sourcePaths: string[], overwrite: boolean) => {
      setUploading(true);
      setScanning(true);
      setUploadMessage(null);
      setUploadError(null);

      try {
        const result = await api.uploadTracks(sourcePaths, overwrite);
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
    [refresh, setScanning],
  );

  const uploadTracks = useCallback(async () => {
    if (!libraryFolder) {
      setUploadError("Choose a library folder before uploading tracks.");
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
      const conflicts = await api.checkUploadConflicts(sourcePaths);
      if (conflicts.length > 0) {
        setPendingUpload({ sourcePaths, conflicts });
        return;
      }
      await runUpload(sourcePaths, false);
    } catch (error) {
      setUploadError(String(error));
    }
  }, [libraryFolder, runUpload]);

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
      message={formatConflictMessage(pendingUpload.conflicts)}
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
  };
}
