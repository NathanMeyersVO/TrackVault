import { useCallback, useEffect, useRef, useState, type Dispatch, type DragEvent, type KeyboardEvent, type MouseEvent, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { ConfirmDialog } from "./ConfirmDialog";
import {
  api,
  COMMON_TAG_KEYS,
  type ApplicationId,
  type Collection,
  type Playlist,
  type Taglist,
  type TaglistValue,
} from "../lib/tauri";
import { getApplicationConfig } from "../lib/applicationConfig";
import { formatTaglistLabel } from "../lib/taglistLabels";
import {
  getCollectionReorderDragData,
  getPlaylistReorderDragData,
  getSublistReorderDragData,
  getTrackDragData,
  isCollectionReorderDrag,
  isPlaylistReorderDrag,
  isSublistReorderDrag,
  reorderItemsByIndex,
  setCollectionReorderDragData,
  setPlaylistReorderDragData,
  setSublistReorderDragData,
} from "../lib/dragDrop";
import {
  sidebarCollectionId,
  sidebarPlaylistId,
  sidebarSublistId,
} from "../lib/sidebarNavigation";
import { useLibrary } from "../hooks/usePlayer";
import { useTagDropConfirm } from "../hooks/useTagDropConfirm";
import { usePlayerStore, type View } from "../store/playerStore";

interface TaglistDropTarget {
  taglistId: number;
  value: string | null;
}

function taglistDropTargetKey(taglistId: number, value: string | null): string {
  return `${taglistId}:${value ?? "NO-TAG"}`;
}

function SublistGripIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="11" cy="12" r="1.2" />
    </svg>
  );
}

function TaglistGroup({
  taglist,
  view,
  setView,
  isTrackDragging,
  draggingTrackId,
  dragOverTarget,
  setDragOverTarget,
  setDraggingTrackId,
  onTagDrop,
  supportsTitleImport,
  titleImportDialog,
}: {
  taglist: Taglist;
  view: View;
  setView: (view: View) => void;
  isTrackDragging: boolean;
  draggingTrackId: number | null;
  dragOverTarget: TaglistDropTarget | null;
  setDragOverTarget: Dispatch<SetStateAction<TaglistDropTarget | null>>;
  setDraggingTrackId: (trackId: number | null) => void;
  onTagDrop: (trackId: number, taglist: Taglist, entry: TaglistValue) => void;
  supportsTitleImport: boolean;
  titleImportDialog?: {
    title: string;
    filters: { name: string; extensions: string[] }[];
  };
}) {
  const { refresh } = useLibrary();
  const [values, setValues] = useState<TaglistValue[]>([]);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);
  const skipBlurSaveRef = useRef(false);

  const taggedValues = values.filter((entry) => entry.value != null);
  const noTagEntry = values.find((entry) => entry.value == null);

  const clearReorderState = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const loadValues = useCallback(() => {
    api.listTaglistValues(taglist.id).then(setValues).catch(console.error);
  }, [taglist.id]);

  useEffect(() => {
    loadValues();
  }, [loadValues]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      loadValues();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadValues]);

  const startEditing = (event: MouseEvent, tagValue: string, displayTitle?: string | null) => {
    event.stopPropagation();
    setEditingValue(tagValue);
    setEditTitle(displayTitle ?? "");
  };

  const cancelEditing = () => {
    skipBlurSaveRef.current = true;
    setEditingValue(null);
    setEditTitle("");
  };

  const saveTitle = async (tagValue: string) => {
    const trimmed = editTitle.trim();
    try {
      await api.setTaglistValueTitle(taglist.id, tagValue, trimmed || null);
      loadValues();
    } catch (error) {
      console.error(error);
    } finally {
      cancelEditing();
    }
  };

  const deleteTaglist = async (event: MouseEvent) => {
    event.stopPropagation();
    await api.deleteTaglist(taglist.id);
    if (
      typeof view === "object" &&
      "taglistId" in view &&
      view.taglistId === taglist.id
    ) {
      setView("library");
    }
    await refresh();
  };

  const importTitles = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!titleImportDialog) return;

    const selected = await open({
      multiple: false,
      title: titleImportDialog.title,
      filters: titleImportDialog.filters,
    });
    if (typeof selected !== "string") return;

    try {
      const count = await api.importTaglistTitles(taglist.id, selected);
      loadValues();
      console.info(`Imported ${count} title mappings`);
    } catch (error) {
      console.error(error);
    }
  };

  const handleSublistReorder = async (orderedValues: TaglistValue[]) => {
    const nextValues = [...orderedValues];
    if (noTagEntry) nextValues.push(noTagEntry);
    setValues(nextValues);
    try {
      await api.reorderTaglistValues(
        taglist.id,
        orderedValues.map((entry) => entry.value!),
      );
    } catch (error) {
      console.error(error);
      loadValues();
    }
  };

  const handleSublistDrop = (
    targetIndex: number,
    event: DragEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (dragIndex == null && !isSublistReorderDrag(event.dataTransfer)) {
      clearReorderState();
      return;
    }

    const fromIndex = dragIndex ?? getSublistReorderDragData(event.dataTransfer);
    if (fromIndex == null || fromIndex === targetIndex) {
      clearReorderState();
      return;
    }

    const row = event.currentTarget.getBoundingClientRect();
    const position: "before" | "after" =
      event.clientY < row.top + row.height / 2 ? "before" : "after";
    const reordered = reorderItemsByIndex(
      taggedValues,
      fromIndex,
      targetIndex,
      position,
    );
    void handleSublistReorder(reordered);
    clearReorderState();
  };

  const renderSublistRow = (
    entry: TaglistValue,
    index: number,
    reorderable: boolean,
  ) => {
    const label = formatTaglistLabel(entry.value, entry.display_title);
    const rowKey = entry.value ?? "NO-TAG";
    const active =
      typeof view === "object" &&
      "taglistId" in view &&
      view.taglistId === taglist.id &&
      view.value === entry.value;
    const isEditing = entry.value != null && editingValue === entry.value;
    const isDragging = reorderable && dragIndex === index;
    const dropIndicator =
      reorderable && dropTarget?.index === index ? dropTarget.position : null;

    const handleNavigate = () => {
      if (isEditing) return;
      setView({ taglistId: taglist.id, value: entry.value });
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (isEditing) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleNavigate();
      }
    };

    if (isEditing && entry.value != null) {
      return (
        <div
          key={rowKey}
          className="mb-0.5 flex items-center gap-1 rounded-md py-1 pl-6 pr-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="shrink-0 text-sm text-muted">{entry.value} -</span>
          <input
            autoFocus
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveTitle(entry.value!);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
            onBlur={() => {
              if (skipBlurSaveRef.current) {
                skipBlurSaveRef.current = false;
                return;
              }
              void saveTitle(entry.value!);
            }}
            placeholder="Display title"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      );
    }

    const isDragOver =
      dragOverTarget?.taglistId === taglist.id &&
      dragOverTarget.value === entry.value;

    const handleDrop = (event: DragEvent) => {
      if (isSublistReorderDrag(event.dataTransfer)) {
        if (reorderable) handleSublistDrop(index, event);
        return;
      }

      event.preventDefault();
      setDragOverTarget(null);
      setDraggingTrackId(null);

      const trackId = draggingTrackId ?? getTrackDragData(event.dataTransfer);
      if (trackId == null) return;

      onTagDrop(trackId, taglist, entry);
    };

    const dropBarClass =
      dropIndicator === "before"
        ? "border-t-2 border-t-drop"
        : dropIndicator === "after"
          ? "border-b-2 border-b-drop"
          : "";
    const stateClass = dropIndicator
      ? ""
      : isDragOver
        ? "border-2 border-accent bg-accent-subtle/40 text-foreground ring-2 ring-accent"
        : isTrackDragging
          ? "border border-dashed border-border bg-surface-hover/50 text-foreground"
          : active
            ? "border border-transparent bg-cursor-background text-foreground"
            : "border border-transparent text-foreground hover:bg-surface-hover/60";

    return (
      <div
        key={rowKey}
        id={sidebarSublistId(taglist.id, entry.value)}
        role="button"
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const row = event.currentTarget.getBoundingClientRect();
            const position: "before" | "after" =
              event.clientY < row.top + row.height / 2 ? "before" : "after";
            setDropTarget({ index, position });
            return;
          }
          if (!isTrackDragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOverTarget({ taglistId: taglist.id, value: entry.value });
        }}
        onDragEnter={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!isTrackDragging) return;
          event.preventDefault();
          setDragOverTarget({ taglistId: taglist.id, value: entry.value });
        }}
        onDragLeave={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDropTarget((current) =>
              current?.index === index ? null : current,
            );
            return;
          }
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          const key = taglistDropTargetKey(taglist.id, entry.value);
          setDragOverTarget((current) =>
            current &&
            taglistDropTargetKey(current.taglistId, current.value) === key
              ? null
              : current,
          );
        }}
        onDrop={handleDrop}
        className={`group/sublist mb-0.5 flex w-full cursor-pointer items-center rounded-md py-1.5 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-muted ${
          reorderable ? "pl-2" : "pl-6"
        } ${dropBarClass} ${isDragging ? "opacity-40" : ""} ${stateClass}`}
      >
        {reorderable && entry.value != null ? (
          <button
            type="button"
            draggable
            aria-label={`Reorder ${label}`}
            className="mr-1 flex shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-muted hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.stopPropagation();
              setSublistReorderDragData(event.dataTransfer, index);
              setDragIndex(index);
            }}
            onDragEnd={() => clearReorderState()}
          >
            <SublistGripIcon />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 cursor-pointer select-none truncate">
          <span className="truncate">{label}</span>
          <span className="ml-1 text-muted">({entry.track_count})</span>
        </span>
        {entry.value != null && (
          <button
            type="button"
            onClick={(event) => startEditing(event, entry.value!, entry.display_title)}
            className="ml-1 hidden shrink-0 rounded px-1 text-xs text-muted hover:text-foreground group-hover/sublist:inline"
            title="Edit title"
          >
            ✎
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mb-2">
      <div className="group flex items-center justify-between px-3 py-1">
        <span className="truncate text-xs font-medium text-muted">
          {taglist.name}
        </span>
        <div className="hidden group-hover:inline">
          {supportsTitleImport ? (
            <button
              type="button"
              onClick={(event) => void importTitles(event)}
              className="rounded px-1 text-xs text-muted hover:text-foreground"
              title="Import titles"
            >
              Titles
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => void deleteTaglist(event)}
            className="rounded px-1 text-xs text-muted hover:text-red-400"
            title="Delete project library taglist"
          >
            ×
          </button>
        </div>
      </div>
      {taggedValues.map((entry, index) => renderSublistRow(entry, index, true))}
      {noTagEntry ? renderSublistRow(noTagEntry, taggedValues.length, false) : null}
    </div>
  );
}

export function Sidebar({ width }: { width: number }) {
  const {
    playlists,
    taglists,
    collections,
    view,
    setView,
    setCollections,
    setPlaylists,
    draggingTrackId,
    setDraggingTrackId,
    activeProject,
  } = usePlayerStore();
  const { refresh } = useLibrary();
  const applicationId: ApplicationId =
    activeProject?.application_id === "usfs_ems" ? "usfs_ems" : "none";
  const applicationConfig = getApplicationConfig(applicationId);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [creatingTaglist, setCreatingTaglist] = useState(false);
  const [newTaglistName, setNewTaglistName] = useState("");
  const [newTaglistValueSingular, setNewTaglistValueSingular] = useState("");
  const [newTaglistKey, setNewTaglistKey] = useState<string>(COMMON_TAG_KEYS[0]);
  const [newTaglistEntryKey, setNewTaglistEntryKey] =
    useState<string>("Track Title");
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<number | null>(null);
  const [dragOverTaglistTarget, setDragOverTaglistTarget] =
    useState<TaglistDropTarget | null>(null);
  const [pendingDeletePlaylist, setPendingDeletePlaylist] = useState<Playlist | null>(null);
  const [pendingDeleteCollection, setPendingDeleteCollection] =
    useState<Collection | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);
  const [deletingCollection, setDeletingCollection] = useState(false);
  const [collectionDragIndex, setCollectionDragIndex] = useState<number | null>(null);
  const [collectionDropTarget, setCollectionDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);
  const [playlistDragIndex, setPlaylistDragIndex] = useState<number | null>(null);
  const [playlistDropTarget, setPlaylistDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState<number | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const renameSkipBlurRef = useRef(false);
  const { requestTagDrop, confirmDialog: tagDropConfirmDialog } = useTagDropConfirm();

  const clearCollectionReorderState = useCallback(() => {
    setCollectionDragIndex(null);
    setCollectionDropTarget(null);
  }, []);

  const handleCollectionReorder = async (orderedCollections: Collection[]) => {
    setCollections(orderedCollections);
    try {
      await api.reorderCollections(orderedCollections.map((collection) => collection.id));
    } catch (error) {
      console.error(error);
      await refresh();
    }
  };

  const handleCollectionDrop = (targetIndex: number, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      collectionDragIndex == null &&
      !isCollectionReorderDrag(event.dataTransfer)
    ) {
      clearCollectionReorderState();
      return;
    }

    const fromIndex =
      collectionDragIndex ?? getCollectionReorderDragData(event.dataTransfer);
    if (fromIndex == null || fromIndex === targetIndex) {
      clearCollectionReorderState();
      return;
    }

    const row = event.currentTarget.getBoundingClientRect();
    const position: "before" | "after" =
      event.clientY < row.top + row.height / 2 ? "before" : "after";
    const reordered = reorderItemsByIndex(
      collections,
      fromIndex,
      targetIndex,
      position,
    );
    void handleCollectionReorder(reordered);
    clearCollectionReorderState();
  };

  const cancelRename = () => {
    renameSkipBlurRef.current = true;
    setEditingPlaylistId(null);
    setEditingCollectionId(null);
    setEditName("");
  };

  const startRenamePlaylist = (event: MouseEvent, playlist: Playlist) => {
    event.stopPropagation();
    setEditingCollectionId(null);
    setEditingPlaylistId(playlist.id);
    setEditName(playlist.name);
  };

  const startRenameCollection = (event: MouseEvent, collection: Collection) => {
    event.stopPropagation();
    setEditingPlaylistId(null);
    setEditingCollectionId(collection.id);
    setEditName(collection.name);
  };

  const savePlaylistRename = async (playlistId: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    const previous = playlists;
    setPlaylists(
      playlists.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, name: trimmed } : playlist,
      ),
    );
    try {
      await api.renamePlaylist(playlistId, trimmed);
    } catch (error) {
      console.error(error);
      setPlaylists(previous);
      await refresh();
    } finally {
      cancelRename();
    }
  };

  const saveCollectionRename = async (collectionId: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    const previous = collections;
    setCollections(
      collections.map((collection) =>
        collection.id === collectionId
          ? { ...collection, name: trimmed }
          : collection,
      ),
    );
    try {
      await api.renameCollection(collectionId, trimmed);
    } catch (error) {
      console.error(error);
      setCollections(previous);
      await refresh();
    } finally {
      cancelRename();
    }
  };

  const clearPlaylistReorderState = useCallback(() => {
    setPlaylistDragIndex(null);
    setPlaylistDropTarget(null);
  }, []);

  const handlePlaylistReorder = async (orderedPlaylists: Playlist[]) => {
    setPlaylists(orderedPlaylists);
    try {
      await api.reorderPlaylists(orderedPlaylists.map((playlist) => playlist.id));
    } catch (error) {
      console.error(error);
      await refresh();
    }
  };

  const handlePlaylistReorderDrop = (targetIndex: number, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      playlistDragIndex == null &&
      !isPlaylistReorderDrag(event.dataTransfer)
    ) {
      clearPlaylistReorderState();
      return;
    }

    const fromIndex =
      playlistDragIndex ?? getPlaylistReorderDragData(event.dataTransfer);
    if (fromIndex == null || fromIndex === targetIndex) {
      clearPlaylistReorderState();
      return;
    }

    const row = event.currentTarget.getBoundingClientRect();
    const position: "before" | "after" =
      event.clientY < row.top + row.height / 2 ? "before" : "after";
    const reordered = reorderItemsByIndex(
      playlists,
      fromIndex,
      targetIndex,
      position,
    );
    void handlePlaylistReorder(reordered);
    clearPlaylistReorderState();
  };

  const isTrackDragging = draggingTrackId != null;

  const handlePlaylistDrop = async (playlistId: number, event: DragEvent) => {
    event.preventDefault();
    setDragOverPlaylistId(null);
    setDraggingTrackId(null);

    const trackId = draggingTrackId ?? getTrackDragData(event.dataTransfer);
    if (trackId == null) return;

    await api.addTrackToPlaylist(playlistId, trackId);
    await refresh();
  };

  const requestDeletePlaylist = (event: MouseEvent, playlist: Playlist) => {
    event.stopPropagation();
    setPendingDeletePlaylist(playlist);
  };

  const cancelDeletePlaylist = () => {
    if (deletingPlaylist) return;
    setPendingDeletePlaylist(null);
  };

  const confirmDeletePlaylist = async () => {
    if (!pendingDeletePlaylist) return;

    setDeletingPlaylist(true);
    try {
      await api.deletePlaylist(pendingDeletePlaylist.id);
      if (
        typeof view === "object" &&
        "playlistId" in view &&
        view.playlistId === pendingDeletePlaylist.id
      ) {
        setView("library");
      }
      await refresh();
      setPendingDeletePlaylist(null);
    } catch (error) {
      console.error(error);
    } finally {
      setDeletingPlaylist(false);
    }
  };

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    await api.createPlaylist(name);
    setNewPlaylistName("");
    setCreating(false);
    await refresh();
  };

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const collectionId = await api.createCollection(name);
    setNewCollectionName("");
    setCreatingCollection(false);
    await refresh();
    setView({ collectionId });
  };

  const requestDeleteCollection = (event: MouseEvent, collection: Collection) => {
    event.stopPropagation();
    setPendingDeleteCollection(collection);
  };

  const cancelDeleteCollection = () => {
    if (deletingCollection) return;
    setPendingDeleteCollection(null);
  };

  const confirmDeleteCollection = async () => {
    if (!pendingDeleteCollection) return;

    setDeletingCollection(true);
    try {
      await api.deleteCollection(pendingDeleteCollection.id);
      if (
        typeof view === "object" &&
        "collectionId" in view &&
        view.collectionId === pendingDeleteCollection.id
      ) {
        setView("library");
      }
      await refresh();
      setPendingDeleteCollection(null);
    } catch (error) {
      console.error(error);
    } finally {
      setDeletingCollection(false);
    }
  };

  const createTaglist = async () => {
    const name = newTaglistName.trim();
    const valueSingular = newTaglistValueSingular.trim();
    if (!name || !valueSingular) return;
    if (!newTaglistKey.trim() || !newTaglistEntryKey.trim()) return;
    if (newTaglistKey === newTaglistEntryKey) return;
    await api.createTaglist(
      name,
      newTaglistKey,
      newTaglistEntryKey,
      valueSingular,
    );
    setNewTaglistName("");
    setNewTaglistValueSingular("");
    setCreatingTaglist(false);
    await refresh();
  };

  const isLibraryActive = view === "library";

  return (
    <aside
      className="flex shrink-0 flex-col bg-surface"
      style={{ width }}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Browse</h2>
        <p className="text-xs text-muted">Project library, stored collections, project library playlists & project library taglists</p>
      </div>

      <nav className="flex-1 overflow-y-auto bg-background p-2">
        <button
          onClick={() => setView("library")}
          className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${
            isLibraryActive
              ? "bg-cursor-background text-foreground"
              : "text-foreground hover:bg-surface-hover/60"
          }`}
        >
          Project library
        </button>

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted">
          Stored Collections
        </div>

        {collections.map((collection, index) => {
          const active =
            typeof view === "object" &&
            "collectionId" in view &&
            view.collectionId === collection.id;
          const isEditing = editingCollectionId === collection.id;
          const isDragging = collectionDragIndex === index;
          const dropIndicator =
            collectionDropTarget?.index === index
              ? collectionDropTarget.position
              : null;
          const dropBarClass =
            dropIndicator === "before"
              ? "border-t-2 border-t-drop"
              : dropIndicator === "after"
                ? "border-b-2 border-b-drop"
                : "";

          return (
            <div
              key={collection.id}
              id={sidebarCollectionId(collection.id)}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (isEditing) return;
                setView({ collectionId: collection.id });
              }}
              onKeyDown={(event) => {
                if (isEditing) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setView({ collectionId: collection.id });
                }
              }}
              onDragOver={(event) => {
                if (
                  collectionDragIndex == null &&
                  !isCollectionReorderDrag(event.dataTransfer)
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                const row = event.currentTarget.getBoundingClientRect();
                const position: "before" | "after" =
                  event.clientY < row.top + row.height / 2 ? "before" : "after";
                setCollectionDropTarget({ index, position });
              }}
              onDragLeave={(event) => {
                if (
                  collectionDragIndex == null &&
                  !isCollectionReorderDrag(event.dataTransfer)
                ) {
                  return;
                }
                setCollectionDropTarget((current) =>
                  current?.index === index ? null : current,
                );
              }}
              onDrop={(event) => handleCollectionDrop(index, event)}
              className={`group/collection mb-1 flex w-full cursor-pointer items-center rounded-md py-2 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-muted pl-2 ${dropBarClass} ${
                isDragging ? "opacity-40" : ""
              } ${
                active
                  ? "border border-transparent bg-cursor-background text-foreground"
                  : "border border-transparent text-foreground hover:bg-surface-hover/60"
              }`}
            >
              <button
                type="button"
                draggable
                aria-label={`Reorder ${collection.name}`}
                className="mr-1 flex shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-muted hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  setCollectionReorderDragData(event.dataTransfer, index);
                  setCollectionDragIndex(index);
                }}
                onDragEnd={() => clearCollectionReorderState()}
              >
                <SublistGripIcon />
              </button>
              {isEditing ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveCollectionRename(collection.id);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (renameSkipBlurRef.current) {
                      renameSkipBlurRef.current = false;
                      return;
                    }
                    void saveCollectionRename(collection.id);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
              ) : (
                <span className="min-w-0 flex-1 cursor-pointer select-none truncate">
                  {collection.name}
                  <span className="ml-1 text-muted">({collection.track_count})</span>
                </span>
              )}
              {!isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => startRenameCollection(event, collection)}
                    className="ml-1 hidden shrink-0 cursor-pointer rounded px-1 text-xs text-muted hover:text-foreground group-hover/collection:inline"
                    title="Rename stored collection"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(event) => requestDeleteCollection(event, collection)}
                    className="ml-1 hidden shrink-0 cursor-pointer rounded px-1 text-xs text-muted hover:text-red-400 group-hover/collection:inline"
                    title="Delete stored collection"
                  >
                    ×
                  </button>
                </>
              ) : null}
            </div>
          );
        })}

        {creatingCollection ? (
          <div className="mt-2 space-y-2 px-2">
            <input
              autoFocus
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createCollection();
                if (e.key === "Escape") setCreatingCollection(false);
              }}
              placeholder="Stored collection name"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void createCollection()}
                className="rounded-md bg-accent px-2 py-1 text-xs text-foreground hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => setCreatingCollection(false)}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreatingCollection(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover/60 hover:text-foreground"
          >
            + New stored collection
          </button>
        )}

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted">
          {isTrackDragging ? "Drop on a project library playlist or project library taglist" : "Project library playlists"}
        </div>

        {playlists.map((playlist, index) => {
          const active =
            typeof view === "object" &&
            "playlistId" in view &&
            view.playlistId === playlist.id;
          const isEditing = editingPlaylistId === playlist.id;
          const isDragOver = dragOverPlaylistId === playlist.id;
          const isDragging = playlistDragIndex === index;
          const dropIndicator =
            playlistDropTarget?.index === index ? playlistDropTarget.position : null;
          const dropBarClass =
            dropIndicator === "before"
              ? "border-t-2 border-t-drop"
              : dropIndicator === "after"
                ? "border-b-2 border-b-drop"
                : "";

          const handleNavigate = () => {
            if (isEditing) return;
            setView({ playlistId: playlist.id } as View);
          };

          const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
            if (isEditing) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleNavigate();
            }
          };

          return (
            <div
              key={playlist.id}
              id={sidebarPlaylistId(playlist.id)}
              role="button"
              tabIndex={0}
              onClick={handleNavigate}
              onKeyDown={handleKeyDown}
              onDragOver={(event) => {
                if (
                  playlistDragIndex != null ||
                  isPlaylistReorderDrag(event.dataTransfer)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  const row = event.currentTarget.getBoundingClientRect();
                  const position: "before" | "after" =
                    event.clientY < row.top + row.height / 2 ? "before" : "after";
                  setPlaylistDropTarget({ index, position });
                  return;
                }
                if (!isTrackDragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragOverPlaylistId(playlist.id);
              }}
              onDragEnter={(event) => {
                if (
                  playlistDragIndex != null ||
                  isPlaylistReorderDrag(event.dataTransfer)
                ) {
                  return;
                }
                if (!isTrackDragging) return;
                event.preventDefault();
                setDragOverPlaylistId(playlist.id);
              }}
              onDragLeave={(event) => {
                if (
                  playlistDragIndex != null ||
                  isPlaylistReorderDrag(event.dataTransfer)
                ) {
                  setPlaylistDropTarget((current) =>
                    current?.index === index ? null : current,
                  );
                  return;
                }
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragOverPlaylistId((current) =>
                  current === playlist.id ? null : current,
                );
              }}
              onDrop={(event) => {
                if (isPlaylistReorderDrag(event.dataTransfer)) {
                  handlePlaylistReorderDrop(index, event);
                  return;
                }
                void handlePlaylistDrop(playlist.id, event);
              }}
              className={`group/playlist mb-1 flex w-full cursor-pointer items-center rounded-md py-2 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-muted pl-2 ${dropBarClass} ${
                isDragging ? "opacity-40" : ""
              } ${
                dropIndicator
                  ? ""
                  : isDragOver
                    ? "border-2 border-accent bg-accent-subtle/40 text-foreground ring-2 ring-accent"
                    : isTrackDragging
                      ? "border border-dashed border-border bg-surface-hover/50 text-foreground"
                      : active
                        ? "border border-transparent bg-cursor-background text-foreground"
                        : "border border-transparent text-foreground hover:bg-surface-hover/60"
              }`}
            >
              <button
                type="button"
                draggable
                aria-label={`Reorder ${playlist.name}`}
                className="mr-1 flex shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-muted hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  setPlaylistReorderDragData(event.dataTransfer, index);
                  setPlaylistDragIndex(index);
                }}
                onDragEnd={() => clearPlaylistReorderState()}
              >
                <SublistGripIcon />
              </button>
              {isEditing ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void savePlaylistRename(playlist.id);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (renameSkipBlurRef.current) {
                      renameSkipBlurRef.current = false;
                      return;
                    }
                    void savePlaylistRename(playlist.id);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
              ) : (
                <span className="min-w-0 flex-1 cursor-pointer select-none truncate">
                  {playlist.name}
                  <span className="ml-1 text-muted">({playlist.track_count})</span>
                </span>
              )}
              {!isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => startRenamePlaylist(event, playlist)}
                    className="ml-1 hidden shrink-0 cursor-pointer rounded px-1 text-xs text-muted hover:text-foreground group-hover/playlist:inline"
                    title="Rename project library playlist"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(event) => requestDeletePlaylist(event, playlist)}
                    className="ml-1 hidden shrink-0 cursor-pointer rounded px-1 text-xs text-muted hover:text-red-400 group-hover/playlist:inline"
                    title="Delete project library playlist"
                  >
                    ×
                  </button>
                </>
              ) : null}
            </div>
          );
        })}

        {creating ? (
          <div className="mt-2 space-y-2 px-2">
            <input
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createPlaylist();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Project library playlist name"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={createPlaylist}
                className="rounded-md bg-accent px-2 py-1 text-xs text-foreground hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover/60 hover:text-foreground"
          >
            + New project library playlist
          </button>
        )}

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted">
          {isTrackDragging ? "Drop on a project library taglist sublist" : "Project library taglists"}
        </div>

        {taglists.map((taglist) => (
          <TaglistGroup
            key={taglist.id}
            taglist={taglist}
            view={view}
            setView={setView}
            isTrackDragging={isTrackDragging}
            draggingTrackId={draggingTrackId}
            dragOverTarget={dragOverTaglistTarget}
            setDragOverTarget={setDragOverTaglistTarget}
            setDraggingTrackId={setDraggingTrackId}
            onTagDrop={(trackId, droppedTaglist, entry) => {
              void requestTagDrop(trackId, droppedTaglist, entry);
            }}
            supportsTitleImport={applicationConfig.supportsTitleImport}
            titleImportDialog={applicationConfig.titleImportDialog}
          />
        ))}

        {creatingTaglist ? (
          <div className="mt-2 space-y-2 px-2">
            <input
              autoFocus
              value={newTaglistName}
              onChange={(e) => setNewTaglistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTaglist();
                if (e.key === "Escape") setCreatingTaglist(false);
              }}
              placeholder="Project library taglist name"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <input
              value={newTaglistValueSingular}
              onChange={(e) => setNewTaglistValueSingular(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTaglist();
                if (e.key === "Escape") setCreatingTaglist(false);
              }}
              placeholder="Sublist label (e.g. Event)"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <select
              value={newTaglistKey}
              onChange={(e) => setNewTaglistKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              aria-label="Partition tag"
            >
              {COMMON_TAG_KEYS.map((key) => (
                <option key={key} value={key}>
                  Partition: {key}
                </option>
              ))}
            </select>
            <select
              value={newTaglistEntryKey}
              onChange={(e) => setNewTaglistEntryKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              aria-label="Entry tag"
            >
              {COMMON_TAG_KEYS.map((key) => (
                <option key={key} value={key}>
                  Entry: {key}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => void createTaglist()}
                className="rounded-md bg-accent px-2 py-1 text-xs text-foreground hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => setCreatingTaglist(false)}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreatingTaglist(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover/60 hover:text-foreground"
          >
            + New project library taglist
          </button>
        )}
      </nav>

      {pendingDeletePlaylist ? (
        <ConfirmDialog
          title="Delete project library playlist"
          message={`Delete "${pendingDeletePlaylist.name}"? This will remove the project library playlist but not the tracks.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          busy={deletingPlaylist}
          onConfirm={() => void confirmDeletePlaylist()}
          onCancel={cancelDeletePlaylist}
        />
      ) : null}
      {pendingDeleteCollection ? (
        <ConfirmDialog
          title="Delete stored collection"
          message={`Delete "${pendingDeleteCollection.name}" and all tracks stored in app data? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          busy={deletingCollection}
          onConfirm={() => void confirmDeleteCollection()}
          onCancel={cancelDeleteCollection}
        />
      ) : null}
      {tagDropConfirmDialog}
    </aside>
  );
}
