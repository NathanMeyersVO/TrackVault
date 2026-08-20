import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/tauri";
import { useLibrary, usePlayer } from "../hooks/usePlayer";
import { useUploadTracks } from "../hooks/useUploadTracks";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore } from "../store/playerStore";
import { TagEditorModal } from "./TagEditorModal";
import { TrackSearchInput } from "./TrackSearchInput";
import { TrackTable } from "./TrackTable";

export function LibraryView() {
  const { tracks, playlists, playback, cursorTrackId, setActiveTrackIds } =
    usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const { refresh } = useLibrary();
  const { uploadTracks, uploading, uploadMessage, uploadError, uploadConfirmDialog } =
    useUploadTracks();
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } = useDeleteTrack();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  useEffect(() => {
    setActiveTrackIds(filteredTracks.map((track) => track.id));
  }, [filteredTracks, setActiveTrackIds]);

  const handleAddToPlaylist = useCallback(
    async (trackId: number, playlistId: number) => {
      await api.addTrackToPlaylist(playlistId, trackId);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Library</h2>
            <p className="text-xs text-neutral-500">
              {isSearching
                ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
                : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void uploadTracks()}
            disabled={uploading}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadMessage ? (
          <p className="mt-2 text-xs text-green-400">{uploadMessage}</p>
        ) : null}
        {uploadError ? (
          <p className="mt-2 text-xs text-red-400">{uploadError}</p>
        ) : null}
      </div>
      <div className="border-b border-neutral-800 px-4 py-2">
        <TrackSearchInput value={query} onChange={setQuery} />
      </div>
      <div className="min-h-0 flex-1">
        <TrackTable
          tracks={filteredTracks}
          playingTrackId={playback.track_id}
          cursorTrackId={cursorTrackId}
          onCursorChange={selectTrack}
          onPlay={playTrack}
          onEditTags={setEditingTrackId}
          playlists={playlists}
          onAddTrackToPlaylist={handleAddToPlaylist}
          onDeleteTrack={requestDeleteTrack}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : "Choose a library folder to get started."
          }
        />
      </div>
      {deleteConfirmDialog}
      {uploadConfirmDialog}
      {editingTrackId != null && (
        <TagEditorModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  );
}
