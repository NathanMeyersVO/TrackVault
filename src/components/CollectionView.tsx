import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import { api, type Track } from "../lib/tauri";
import { useDeleteCollectionTrack } from "../hooks/useDeleteCollectionTrack";
import { usePlayer } from "../hooks/usePlayer";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore } from "../store/playerStore";
import { TagEditorModal } from "./TagEditorModal";
import { TrackSearchInput } from "./TrackSearchInput";
import { TrackTable } from "./TrackTable";

interface CollectionViewProps {
  collectionId: number;
}

export function CollectionView({ collectionId }: CollectionViewProps) {
  const {
    collections,
    playback,
    cursorTrackId,
    setActiveTrackIds,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } =
    useDeleteCollectionTrack();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  const collection = collections.find((entry) => entry.id === collectionId);

  const refreshTracks = useCallback(() => {
    api.getCollectionTracks(collectionId).then(setTracks).catch(console.error);
  }, [collectionId]);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks, collections]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      refreshTracks();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTracks]);

  useEffect(() => {
    setActiveTrackIds(filteredTracks.map((track) => track.id));
  }, [filteredTracks, setActiveTrackIds]);

  const reorderTracks = async (orderedIds: number[]) => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    setTracks(
      orderedIds
        .map((id) => byId.get(id))
        .filter((track): track is Track => track != null),
    );
    try {
      await api.reorderCollectionTracks(collectionId, orderedIds);
    } catch (error) {
      console.error(error);
      refreshTracks();
    }
  };

  const exportCollection = async () => {
    setExportError(null);
    const defaultName = `${collection?.name ?? "collection"}.tgz`;
    const destination = await save({
      title: "Export stored collection",
      defaultPath: defaultName,
      filters: [{ name: "TrackVault stored collection", extensions: ["tgz"] }],
    });
    if (destination == null) return;

    try {
      await api.exportCollection(collectionId, destination);
    } catch (error) {
      setExportError(String(error));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              {collection?.name ?? "Stored collection"}
            </h2>
            <p className="text-xs text-muted">
              {isSearching
                ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
                : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void exportCollection()}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
          >
            Export…
          </button>
        </div>
        {exportError ? (
          <p className="mt-2 text-xs text-red-400">{exportError}</p>
        ) : null}
      </div>
      <div className="border-b border-border px-4 py-2">
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
          onDeleteTrack={requestDeleteTrack}
          onReorderTracks={isSearching ? undefined : reorderTracks}
          draggable={false}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : "No tracks in this stored collection yet. Use File → Upload to stored collection… to add audio files."
          }
        />
      </div>
      {deleteConfirmDialog}
      {editingTrackId != null && (
        <TagEditorModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  );
}

export async function importCollectionFromDialog(): Promise<number | null> {
  const source = await open({
    multiple: false,
    title: "Import stored collection",
    filters: [{ name: "TrackVault stored collection", extensions: ["tgz"] }],
  });
  if (source == null || Array.isArray(source)) return null;
  return api.importCollection(source);
}
