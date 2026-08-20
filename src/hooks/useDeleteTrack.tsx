import { useCallback, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { api, type Track } from "../lib/tauri";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

export function useDeleteTrack() {
  const { refresh } = useLibrary();
  const { cursorTrackId, setCursorTrackId, setPlayback } = usePlayerStore();
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null);
  const [deleting, setDeleting] = useState(false);

  const requestDeleteTrack = useCallback((track: Track) => {
    setPendingTrack(track);
  }, []);

  const cancelDeleteTrack = useCallback(() => {
    if (deleting) return;
    setPendingTrack(null);
  }, [deleting]);

  const confirmDeleteTrack = useCallback(async () => {
    if (!pendingTrack) return;

    setDeleting(true);
    try {
      const playback = await api.deleteTrack(pendingTrack.id);
      invalidateTrackTags(pendingTrack.id);
      setPlayback(playback);
      if (cursorTrackId === pendingTrack.id) {
        setCursorTrackId(null);
      }
      await refresh();
      setPendingTrack(null);
    } catch (error) {
      console.error(error);
    } finally {
      setDeleting(false);
    }
  }, [
    cursorTrackId,
    pendingTrack,
    refresh,
    setCursorTrackId,
    setPlayback,
  ]);

  const confirmDialog = pendingTrack ? (
    <ConfirmDialog
      title="Delete track"
      message={`Delete "${pendingTrack.title}" from the library? This will remove it from all playlists and taglists and delete the file. This cannot be undone.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      destructive
      busy={deleting}
      onConfirm={() => void confirmDeleteTrack()}
      onCancel={cancelDeleteTrack}
    />
  ) : null;

  return {
    requestDeleteTrack,
    confirmDialog,
  };
}
