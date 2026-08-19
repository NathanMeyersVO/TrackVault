import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type TaglistValue, type Track } from "../lib/tauri";
import { formatTaglistLabel } from "../lib/taglistLabels";
import { usePlayer } from "../hooks/usePlayer";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore } from "../store/playerStore";
import { TagEditorModal } from "./TagEditorModal";
import { TrackSearchInput } from "./TrackSearchInput";
import { TrackTable } from "./TrackTable";

interface TaglistViewProps {
  taglistId: number;
  value: string | null;
}

export function TaglistView({ taglistId, value }: TaglistViewProps) {
  const {
    taglists,
    playback,
    cursorTrackId,
    cursorTaglistFooter,
    setActiveTrackIds,
    setView,
    setTaglistNav,
    setCursorTaglistFooter,
    setCursorTrackId,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [values, setValues] = useState<TaglistValue[]>([]);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  const taglist = taglists.find((entry) => entry.id === taglistId);
  const currentValue = values.find((entry) => entry.value === value);
  const displayName = formatTaglistLabel(value, currentValue?.display_title);

  const currentIndex = useMemo(
    () => values.findIndex((entry) => entry.value === value),
    [values, value],
  );
  const nextSublist =
    currentIndex >= 0 && currentIndex < values.length - 1
      ? values[currentIndex + 1]
      : null;
  const hasNextSublist = nextSublist != null && !isSearching;

  const refreshTracks = useCallback(() => {
    api.getTaglistTracks(taglistId, value).then(setTracks).catch(console.error);
  }, [taglistId, value]);

  const refreshValues = useCallback(() => {
    api.listTaglistValues(taglistId).then(setValues).catch(console.error);
  }, [taglistId]);

  const activateNextSublist = useCallback(() => {
    if (!nextSublist) return;
    setCursorTaglistFooter(false);
    const nextValue = nextSublist.value;
    setView({ taglistId, value: nextValue });
    void api
      .getTaglistTracks(taglistId, nextValue)
      .then((loaded) => {
        if (loaded[0]) selectTrack(loaded[0].id);
        else setCursorTrackId(null);
      })
      .catch(console.error);
  }, [
    nextSublist,
    selectTrack,
    setCursorTaglistFooter,
    setCursorTrackId,
    setView,
    taglistId,
  ]);

  useEffect(() => {
    refreshTracks();
    refreshValues();
  }, [refreshTracks, refreshValues, taglists]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      refreshTracks();
      refreshValues();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTracks, refreshValues]);

  useEffect(() => {
    setActiveTrackIds(filteredTracks.map((track) => track.id));
  }, [filteredTracks, setActiveTrackIds]);

  useEffect(() => {
    if (hasNextSublist) {
      setTaglistNav({ hasNextSublist: true, activateNextSublist });
    } else {
      setTaglistNav(null);
      setCursorTaglistFooter(false);
    }
  }, [
    activateNextSublist,
    hasNextSublist,
    setCursorTaglistFooter,
    setTaglistNav,
  ]);

  useEffect(() => {
    return () => {
      setTaglistNav(null);
      setCursorTaglistFooter(false);
    };
  }, [setCursorTaglistFooter, setTaglistNav]);

  const reorderTracks = async (orderedIds: number[]) => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    setTracks(
      orderedIds
        .map((id) => byId.get(id))
        .filter((track): track is Track => track != null),
    );
    try {
      await api.reorderTaglistTracks(taglistId, value, orderedIds);
    } catch (error) {
      console.error(error);
      refreshTracks();
    }
  };

  const selectFooter = () => {
    setCursorTaglistFooter(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold text-white">{displayName}</h2>
        <p className="text-xs text-neutral-500">
          {taglist ? `${taglist.name} · ${taglist.tag_key} · ` : ""}
          {isSearching
            ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
            : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </p>
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
          onReorderTracks={isSearching ? undefined : reorderTracks}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : value == null
                ? "No tracks without this tag."
                : "No tracks with this tag."
          }
          footerRow={
            hasNextSublist
              ? {
                  label: "Next taglist",
                  isSelected: cursorTaglistFooter,
                  onSelect: selectFooter,
                  onActivate: activateNextSublist,
                }
              : undefined
          }
        />
      </div>
      {editingTrackId != null && (
        <TagEditorModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  );
}
