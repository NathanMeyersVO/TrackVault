import { useCallback, useEffect, useState } from "react";

import { getDeliveryCopy } from "../lib/applicationConfig";
import { api } from "../lib/tauri";
import { useLibrary, usePlayer } from "../hooks/usePlayer";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useReplaceLibraryTrackFile } from "../hooks/useReplaceLibraryTrackFile";
import { useProjectLibrarySearch } from "../hooks/useProjectLibrarySearch";
import { usePlayerStore } from "../store/playerStore";
import { playerController } from "../playerController";
import { TagEditorModal } from "./TagEditorModal";
import { ProjectLibrarySearchPanel } from "./ProjectLibrarySearchPanel";
import { TrackTable } from "./TrackTable";

export function LibraryView() {
  const {
    tracks,
    playlists,
    playback,
    cursorTrackId,
    setActiveTrackIds,
    activeProject,
    libraryFolder,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const { refresh } = useLibrary();
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } = useDeleteTrack();
  const { requestReplaceFile, replaceFileModal } = useReplaceLibraryTrackFile();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const { query, setQuery, filteredTracks, isSearching, hits, searchLoading, searchError, globalHitCount } =
    useProjectLibrarySearch(tracks);

  useEffect(() => {
    const trackIds = filteredTracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    playerController.syncTracklistContext("library", trackIds);
  }, [filteredTracks, setActiveTrackIds]);

  const hasOpenProject = activeProject != null || libraryFolder != null;

  const libraryEmptyMessage = isSearching
    ? "No tracks match your search."
    : !hasOpenProject
      ? "Open or create a project: Library → Projects…"
      : getDeliveryCopy(activeProject?.application_id).libraryEmptyWithProject;

  const handleAddToPlaylist = useCallback(
    async (trackId: number, playlistId: number) => {
      await api.addTrackToPlaylist(playlistId, trackId);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-white">Project library</h2>
        <p className="text-xs text-muted">
          {isSearching
            ? `${filteredTracks.length} in view · ${globalHitCount} project-wide`
            : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <div className="border-b border-border px-4 py-2">
        <ProjectLibrarySearchPanel
          query={query}
          onQueryChange={setQuery}
          hits={hits}
          isSearching={isSearching}
          searchLoading={searchLoading}
          searchError={searchError}
        />
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
          onReplaceFile={requestReplaceFile}
          emptyMessage={libraryEmptyMessage}
        />
      </div>
      {deleteConfirmDialog}
      {replaceFileModal}
      {editingTrackId != null && (
        <TagEditorModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  );
}
