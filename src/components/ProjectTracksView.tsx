import { useCallback, useEffect, useState } from "react";

import { getDeliveryCopy } from "../lib/applicationConfig";
import { api } from "../lib/tauri";
import { useProject, usePlayer } from "../hooks/usePlayer";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useReplaceProjectTrackFile } from "../hooks/useReplaceProjectTrackFile";
import { useProjectSearch } from "../hooks/useProjectSearch";
import { formatProjectSearchSubtitle } from "../lib/projectSearchCopy";
import { usePlayerStore } from "../store/playerStore";
import { playerController } from "../playerController";
import { TagEditorModal } from "./TagEditorModal";
import { ProjectSearchPanel } from "./ProjectSearchPanel";
import { TrackTable } from "./TrackTable";

export function ProjectTracksView() {
  const {
    tracks,
    playlists,
    playback,
    cursorTrackId,
    setActiveTrackIds,
    activeProject,
    projectFolder,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const { refresh } = useProject();
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } = useDeleteTrack();
  const { requestReplaceFile, replaceFileModal } = useReplaceProjectTrackFile();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const { query, setQuery, isSearching, hits, searchLoading, searchError, globalHitCount } =
    useProjectSearch();

  useEffect(() => {
    const trackIds = tracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    playerController.syncTracklistContext("project_tracks", trackIds);
  }, [tracks, setActiveTrackIds]);

  const hasOpenProject = activeProject != null || projectFolder != null;

  const projectEmptyMessage = !hasOpenProject
    ? "Open or create a project: Project → Projects…"
    : getDeliveryCopy(activeProject?.application_id).projectEmptyWithProject;

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
        <h2 className="text-base font-semibold text-white">Project Tracks</h2>
        <p className="text-xs text-muted">
          {isSearching
            ? formatProjectSearchSubtitle(searchLoading, globalHitCount)
            : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <div className="border-b border-border px-4 py-2">
        <ProjectSearchPanel
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
          tracks={tracks}
          playingTrackId={playback.track_id}
          cursorTrackId={cursorTrackId}
          onCursorChange={selectTrack}
          onPlay={playTrack}
          onEditTags={setEditingTrackId}
          playlists={playlists}
          onAddTrackToPlaylist={handleAddToPlaylist}
          onDeleteTrack={requestDeleteTrack}
          onReplaceFile={requestReplaceFile}
          emptyMessage={projectEmptyMessage}
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
