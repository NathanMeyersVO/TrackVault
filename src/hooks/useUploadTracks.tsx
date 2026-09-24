import { useCallback, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";



import { ConfirmDialog } from "../components/ConfirmDialog";

import { AUDIO_FILE_DIALOG_FILTER } from "../lib/audioExtensions";

import { api } from "../lib/tauri";

import {

  formatLibraryConflictMessage,

  formatUploadResult,

} from "../lib/uploadFeedback";

import { useLibrary } from "./usePlayer";

import { usePlayerStore } from "../store/playerStore";



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

    [refresh, setScanning],

  );



  const uploadFromPaths = useCallback(

    async (sourcePaths: string[]) => {

      if (!libraryFolder) {

        setUploadError("Choose a project library folder before uploading tracks.");

        setUploadMessage(null);

        return false;

      }

      if (sourcePaths.length === 0) return false;



      try {

        const conflicts = await api.checkUploadConflicts(sourcePaths);

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

    [libraryFolder, runUpload],

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

      message={formatLibraryConflictMessage(pendingUpload.conflicts)}

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

