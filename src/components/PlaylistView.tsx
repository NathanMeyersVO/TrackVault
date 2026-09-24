import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type Track } from "../lib/tauri";
import { usePlayer } from "../hooks/usePlayer";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useReplaceLibraryTrackFile } from "../hooks/useReplaceLibraryTrackFile";
import { useProjectLibrarySearch } from "../hooks/useProjectLibrarySearch";
import { usePlayerStore, serializeView } from "../store/playerStore";
import { playerController } from "../playerController";
import { TagEditorModal } from "./TagEditorModal";
import { ProjectLibrarySearchPanel } from "./ProjectLibrarySearchPanel";
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
  const { requestReplaceFile, replaceFileModal } = useReplaceLibraryTrackFile();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const {
    query,
    setQuery,
    filteredTracks,
    isSearching,
    hits,
    searchLoading,
    searchError,
    globalHitCount,
  } = useProjectLibrarySearch(tracks);

  const playlist = playlists.find((p) => p.id === playlistId);

  const refreshTracks = useCallback(() => {
    api.getPlaylistTracks(playlistId).then(setTracks).catch(console.error);
  }, [playlistId]);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks, playlists]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      refreshTracks();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTracks]);

  useEffect(() => {
    const trackIds = filteredTracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    playerController.syncTracklistContext(
      serializeView({ playlistId }),
      trackIds,
    );
  }, [filteredTracks, playlistId, setActiveTrackIds]);

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
          {playlist?.name ?? "Project library playlist"}
        </h2>
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
          onRemoveTrackFromPlaylist={removeTrack}
          onDeleteTrack={requestDeleteTrack}
          onReplaceFile={requestReplaceFile}
          onReorderTracks={isSearching ? undefined : reorderTracks}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : "No tracks in this project library playlist yet. Add tracks from the project library."
          }
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