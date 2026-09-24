import { useCallback, useState } from "react";

import { ReplaceTrackFileModal } from "../components/ReplaceTrackFileModal";
import type { Track } from "../lib/tauri";

export function useReplaceLibraryTrackFile() {
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null);

  const requestReplaceFile = useCallback((track: Track) => {
    setPendingTrack(track);
  }, []);

  const closeModal = useCallback(() => {
    setPendingTrack(null);
  }, []);

  const modal = pendingTrack ? (
    <ReplaceTrackFileModal track={pendingTrack} onClose={closeModal} />
  ) : null;

  return {
    requestReplaceFile,
    replaceFileModal: modal,
  };
}
