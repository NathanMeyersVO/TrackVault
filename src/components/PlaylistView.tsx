import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type Track } from "../lib/tauri";
import { usePlayer } from "../hooks/usePlayer";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useReplaceProjectTrackFile } from "../hooks/useReplaceProjectTrackFile";
import { useProjectSearch } from "../hooks/useProjectSearch";
import { formatProjectSearchSubtitle } from "../lib/projectSearchCopy";
import { usePlayerStore, serializeView } from "../store/playerStore";
import { playerController } from "../playerController";
import { TagEditorModal } from "./TagEditorModal";
import { ProjectSearchPanel } from "./ProjectSearchPanel";
import { TrackTable } from "./TrackTable";

interface PlaylistViewProps {
  playlistId: number;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
  const {
    playlists,
    playback,
    cursorTrackId,
    setActiveTrackIds,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } = useDeleteTrack();
  const { requestReplaceFile, replaceFileModal } = useReplaceProjectTrackFile();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const {
    query,
    setQuery,
    isSearching,
    hits,
    searchLoading,
    searchError,
    globalHitCount,
  } = useProjectSearch();

  const playlist = playlists.find((p) => p.id === playlistId);

  const refreshTracks = useCallback(() => {
    api.getPlaylistTracks(playlistId).then(setTracks).catch(console.error);
  }, [playlistId]);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks, playlists]);

  useEffect(() => {
    const unlisten = listen("project-updated", () => {
      refreshTracks();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTracks]);

  useEffect(() => {
    const trackIds = tracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    playerController.syncTracklistContext(
      serializeView({ playlistId }),
      trackIds,
    );
  }, [tracks, playlistId, setActiveTrackIds]);

  const removeTrack = async (trackId: number) => {
    await api.removeTrackFromPlaylist(playlistId, trackId);
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  };

  const reorderTracks = async (orderedIds: number[]) => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    setTracks(
      orderedIds
        .map((id) => byId.get(id))
        .filter((track): track is Track => track != null),
    );
    try {
      await api.reorderPlaylistTracks(playlistId, orderedIds);
    } catch (error) {
      console.error(error);
      refreshTracks();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-white">
          {playlist?.name ?? "Project playlist"}
        </h2>
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
          onRemoveTrackFromPlaylist={removeTrack}
          onDeleteTrack={requestDeleteTrack}
          onReplaceFile={requestReplaceFile}
          onReorderTracks={isSearching ? undefined : reorderTracks}
          emptyMessage="No tracks in this project playlist yet. Add tracks from the project."
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