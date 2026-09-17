import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type TaglistValue, type Track } from "../lib/tauri";
import { formatTaglistLabel, getTaglistValueSingularLabel } from "../lib/taglistLabels";
import { usePlayer } from "../hooks/usePlayer";
import { useDeleteTrack } from "../hooks/useDeleteTrack";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore, serializeView } from "../store/playerStore";
import { playerController } from "../playerController";
import { scrollSidebarItem, sidebarSublistId } from "../lib/sidebarNavigation";
import { ChangeTaglistValueModal } from "./ChangeTaglistValueModal";
import { SwapTaglistEntryModal } from "./SwapTaglistEntryModal";
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
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const { requestDeleteTrack, confirmDialog: deleteConfirmDialog } = useDeleteTrack();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [values, setValues] = useState<TaglistValue[]>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [changingTrackId, setChangingTrackId] = useState<number | null>(null);
  const [swappingTrackId, setSwappingTrackId] = useState<number | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  const taglist = taglists.find((entry) => entry.id === taglistId);
  const changeTaglistValueLabel = taglist
    ? getTaglistValueSingularLabel(taglist)
    : undefined;
  const swapTaglistEntryLabel =
    taglist && taglist.entry_tag_key.trim()
      ? taglist.entry_tag_key
      : undefined;
  const swappingTrack =
    swappingTrackId != null
      ? tracks.find((track) => track.id === swappingTrackId)
      : undefined;
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
  const previousSublist =
    currentIndex > 0 ? values[currentIndex - 1] : null;
  const hasNextSublist = nextSublist != null && !isSearching;
  const hasPreviousSublist = previousSublist != null && !isSearching;
  const nextSublistLabel = nextSublist
    ? formatTaglistLabel(nextSublist.value, nextSublist.display_title)
    : null;
  const footerLabel =
    nextSublistLabel != null ? `Next library taglist (${nextSublistLabel})` : null;

  const refreshTracks = useCallback(() => {
    api
      .getTaglistTracks(taglistId, value)
      .then((loaded) => {
        setTracks(loaded);
        setTracksLoaded(true);
      })
      .catch(console.error);
  }, [taglistId, value]);

  const refreshValues = useCallback(() => {
    api.listTaglistValues(taglistId).then(setValues).catch(console.error);
  }, [taglistId]);

  useEffect(() => {
    setTracks([]);
    setTracksLoaded(false);
  }, [taglistId, value]);

  const activateNextSublist = useCallback(() => {
    if (!nextSublist) return;
    setCursorTaglistFooter(false);
    setView({ taglistId, value: nextSublist.value });
    scrollSidebarItem(sidebarSublistId(taglistId, nextSublist.value));
  }, [nextSublist, setCursorTaglistFooter, setView, taglistId]);

  const activatePreviousSublist = useCallback(() => {
    if (!previousSublist) return;
    setCursorTaglistFooter(false);
    setView({ taglistId, value: previousSublist.value });
    scrollSidebarItem(sidebarSublistId(taglistId, previousSublist.value));
  }, [previousSublist, setCursorTaglistFooter, setView, taglistId]);

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
    if (!tracksLoaded) return;
    const trackIds = filteredTracks.map((track) => track.id);
    setActiveTrackIds(trackIds);
    playerController.syncTracklistContext(
      serializeView({ taglistId, value }),
      trackIds,
    );
  }, [
    filteredTracks,
    setActiveTrackIds,
    taglistId,
    tracksLoaded,
    value,
  ]);

  useEffect(() => {
    if (hasNextSublist || hasPreviousSublist) {
      setTaglistNav({
        hasNextSublist,
        hasPreviousSublist,
        activateNextSublist,
        activatePreviousSublist,
      });
    } else {
      setTaglistNav(null);
      setCursorTaglistFooter(false);
    }
  }, [
    activateNextSublist,
    activatePreviousSublist,
    hasNextSublist,
    hasPreviousSublist,
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
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-white">{displayName}</h2>
        <p className="text-xs text-muted">
          {taglist
            ? `${taglist.name} · partition: ${taglist.tag_key}${
                taglist.entry_tag_key.trim()
                  ? ` · entry: ${taglist.entry_tag_key}`
                  : ""
              } · `
            : ""}
          {isSearching
            ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
            : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </p>
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
          changeTaglistValueLabel={changeTaglistValueLabel}
          onChangeTaglistValue={setChangingTrackId}
          swapTaglistEntryLabel={swapTaglistEntryLabel}
          onSwapTaglistEntry={swapTaglistEntryLabel ? setSwappingTrackId : undefined}
          onDeleteTrack={requestDeleteTrack}
          onReorderTracks={isSearching ? undefined : reorderTracks}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : value == null
                ? "No tracks without this tag."
                : "No tracks with this tag."
          }
          footerRow={
            hasNextSublist && footerLabel
              ? {
                  label: footerLabel,
                  isSelected: cursorTaglistFooter,
                  onSelect: selectFooter,
                  onActivate: activateNextSublist,
                }
              : undefined
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
      {changingTrackId != null && taglist && (
        <ChangeTaglistValueModal
          trackId={changingTrackId}
          taglist={taglist}
          onClose={() => setChangingTrackId(null)}
        />
      )}
      {swappingTrackId != null && swappingTrack && taglist && (
        <SwapTaglistEntryModal
          taglist={taglist}
          taglistId={taglistId}
          partitionValue={value}
          trackId={swappingTrackId}
          trackTitle={swappingTrack.title}
          onClose={() => setSwappingTrackId(null)}
          onSwapped={() => {
            refreshTracks();
            refreshValues();
          }}
        />
      )}
    </div>
  );
}
