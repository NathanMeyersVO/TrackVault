import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import { api, type CollectionPlaybackMode, type Track } from "../lib/tauri";
import { useDeleteCollectionTrack } from "../hooks/useDeleteCollectionTrack";
import { useLibrary, usePlayer } from "../hooks/usePlayer";
import { playerController } from "../playerController";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore, serializeView } from "../store/playerStore";
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
  const { refresh } = useLibrary();
  const [tracks, setTracks] = useState<Track[]>([]);
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } =
    useDeleteCollectionTrack();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  const collection = collections.find((entry) => entry.id === collectionId);
  const playbackMode = collection?.playback_mode ?? "discrete";
  const continuousVolume = collection?.continuous_volume ?? 0.5;
  const continuousVolumePercent = Math.round(continuousVolume * 100);

  const handlePlaybackModeChange = useCallback(
    async (nextMode: CollectionPlaybackMode) => {
      if (nextMode === playbackMode) return;
      try {
        await api.setCollectionPlaybackMode(collectionId, nextMode);
        await refresh();
      } catch (error) {
        console.error(error);
      }
    },
    [collectionId, playbackMode, refresh],
  );

  const handleContinuousVolumeChange = useCallback(
    async (nextVolume: number) => {
      const clamped = Math.min(1, Math.max(0, nextVolume));
      if (Math.abs(clamped - continuousVolume) < 0.001) return;
      try {
        await api.setCollectionContinuousVolume(collectionId, clamped);
        await refresh();
        const { continuousPlaybackCollectionId } = usePlayerStore.getState();
        if (continuousPlaybackCollectionId === collectionId) {
          playerController.reapplyVolume();
        }
      } catch (error) {
        console.error(error);
      }
    },
    [collectionId, continuousVolume, refresh],
  );

  useEffect(() => {
    const trackIds = filteredTracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    const viewKey = serializeView({ collectionId });
    if (playbackMode === "continuous" && trackIds.length > 0) {
      void playerController.syncContinuousCollectionContext(
        collectionId,
        trackIds,
        viewKey,
      );
    } else {
      playerController.syncTracklistContext(viewKey, trackIds);
    }
  }, [collectionId, filteredTracks, playbackMode, setActiveTrackIds]);

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
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-white">
              {collection?.name ?? "Stored collection"}
            </h2>
            <p className="text-xs text-muted">
              {isSearching
                ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
                : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span>Playback</span>
              <select
                value={playbackMode}
                onChange={(event) =>
                  void handlePlaybackModeChange(
                    event.target.value as CollectionPlaybackMode,
                  )
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="discrete">Discrete</option>
                <option value="continuous">Continuous background</option>
              </select>
            </label>
            {playbackMode === "continuous" ? (
              <label className="flex min-w-40 items-center gap-1.5 text-xs text-muted">
                <span className="shrink-0">Background volume</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={continuousVolumePercent}
                  onChange={(event) =>
                    void handleContinuousVolumeChange(
                      Number(event.target.value) / 100,
                    )
                  }
                  className="h-1 w-20 cursor-pointer accent-accent"
                  title={`Background volume ${continuousVolumePercent}% of master`}
                />
                <span className="w-8 shrink-0 tabular-nums">{continuousVolumePercent}%</span>
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => void exportCollection()}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
            >
              Export…
            </button>
          </div>
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
              : "No tracks in this stored collection yet. Use Stored Collections → Upload to stored collection… to add audio files."
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
