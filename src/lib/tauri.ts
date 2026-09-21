import { invoke } from "@tauri-apps/api/core";

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  track_number: number | null;
  added_at: number;
  has_peaks: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  created_at: number;
  track_count: number;
}

export type CollectionPlaybackMode = "discrete" | "continuous";

export interface Collection {
  id: number;
  name: string;
  created_at: number;
  track_count: number;
  playback_mode: CollectionPlaybackMode;
  continuous_volume: number;
}

export interface CollectionPlaybackState {
  track_id: number | null;
  position_ms: number;
}

export interface Taglist {
  id: number;
  name: string;
  tag_key: string;
  entry_tag_key: string;
  value_singular_name: string;
  created_at: number;
}

export interface TaglistSwapTarget {
  partition_value: string | null;
  partition_display_title?: string | null;
  track_id: number;
  track_title: string;
}

export interface TaglistValue {
  value: string | null;
  track_count: number;
  display_title?: string | null;
}

export interface PlaybackState {
  track_id: number | null;
  position_ms: number;
  duration_ms: number;
  is_playing: boolean;
}

export interface WaveformPeaks {
  peaks: number[];
  duration_ms: number;
}

export interface ScanProgress {
  scanned: number;
  added: number;
  removed: number;
  done: boolean;
}

export interface AudioCacheProgress {
  done: number;
  total: number;
  finished: boolean;
}

export interface AudioCacheTrackReady {
  track_id: number;
}

export interface UploadResult {
  uploaded: number;
  skipped: number;
  errors: string[];
}

export interface ReplaceTrackTagValue {
  key: string;
  value: string;
}

export interface ReplaceTrackFileSide {
  file_name: string;
  duration_ms: number;
  file_size_bytes: number;
  tags: ReplaceTrackTagValue[];
}

export interface ReplaceTrackFilePreview {
  existing: ReplaceTrackFileSide;
  replacement: ReplaceTrackFileSide;
  library_path_before: string;
  library_path_after: string;
  path_collision: boolean;
  collision_message: string | null;
}

export interface ReplaceRemoteUploadStartInfo {
  uploadUrl: string;
  lanIp: string;
  port: number;
  expiresAtMs: number;
  alternateUrls: string[];
  localhostTestUrl: string;
  logFilePath: string;
}

export interface ReplaceRemoteUploadStatus {
  active: boolean;
  status: string;
  sourcePath: string | null;
  error: string | null;
  trackId: number | null;
}

export interface TagField {
  key: string;
  value: string;
  editable: boolean;
}

export interface TrackTagInfo {
  file_name: string;
  path: string;
  tag_type: string | null;
  fields: TagField[];
}

export const COMMON_TAG_KEYS = [
  "Track Title",
  "Track Artist",
  "Album Title",
  "Album Artist",
  "Track Number",
  "Track Total",
  "Disc Number",
  "Disc Total",
  "Genre",
  "Comment",
  "Recording Date",
  "Year",
  "Composer",
  "Conductor",
  "Label",
  "Copyright",
] as const;

export interface ThemeSettings {
  theme_id: string;
}

export type ApplicationId = "none" | "usfs_ems";

export interface ApplicationSettings {
  application_id: ApplicationId;
}

export const api = {
  listTracks: () => invoke<Track[]>("list_tracks"),
  getTrack: (trackId: number) => invoke<Track>("get_track", { trackId }),
  getLibraryFolder: () => invoke<string | null>("get_library_folder"),
  setLibraryFolder: (path: string) =>
    invoke<ScanProgress>("set_library_folder", { path }),
  scanLibrary: () => invoke<ScanProgress>("scan_library"),
  uploadTracks: (sourcePaths: string[], overwrite = false) =>
    invoke<UploadResult>("upload_tracks", { sourcePaths, overwrite }),
  checkUploadConflicts: (sourcePaths: string[]) =>
    invoke<string[]>("check_upload_conflicts", { sourcePaths }),
  previewReplaceLibraryTrackFile: (trackId: number, sourcePath: string) =>
    invoke<ReplaceTrackFilePreview>("preview_replace_library_track_file", {
      trackId,
      sourcePath,
    }),
  replaceLibraryTrackFile: (trackId: number, sourcePath: string) =>
    invoke<Track>("replace_library_track_file", { trackId, sourcePath }),
  startReplaceRemoteUpload: (trackId: number) =>
    invoke<ReplaceRemoteUploadStartInfo>("start_replace_remote_upload", { trackId }),
  stopReplaceRemoteUpload: () => invoke<void>("stop_replace_remote_upload"),
  getReplaceRemoteUploadStatus: () =>
    invoke<ReplaceRemoteUploadStatus>("get_replace_remote_upload_status"),
  getReplaceRemoteUploadLogPath: () =>
    invoke<string>("get_replace_remote_upload_log_path"),
  getReplaceRemoteUploadLogsDir: () =>
    invoke<string>("get_replace_remote_upload_logs_dir"),
  deleteTrack: (trackId: number) =>
    invoke<PlaybackState>("delete_track", { trackId }),
  saveLibraryConfig: () => invoke<string>("save_library_config"),
  loadLibraryConfig: () => invoke<string>("load_library_config"),
  resetLibrary: () => invoke<PlaybackState>("close_library"),
  closeLibrary: () => invoke<PlaybackState>("close_library"),
  createCollection: (name: string) =>
    invoke<number>("create_collection", { name }),
  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),
  renameCollection: (id: number, name: string) =>
    invoke<void>("rename_collection", { id, name }),
  listCollections: () => invoke<Collection[]>("list_collections"),
  getCollectionTracks: (collectionId: number) =>
    invoke<Track[]>("get_collection_tracks", { collectionId }),
  reorderCollectionTracks: (collectionId: number, trackIds: number[]) =>
    invoke<void>("reorder_collection_tracks", { collectionId, trackIds }),
  reorderCollections: (collectionIds: number[]) =>
    invoke<void>("reorder_collections", { collectionIds }),
  uploadCollectionTracks: (
    collectionId: number,
    sourcePaths: string[],
    overwrite = false,
  ) =>
    invoke<UploadResult>("upload_collection_tracks", {
      collectionId,
      sourcePaths,
      overwrite,
    }),
  checkCollectionUploadConflicts: (
    collectionId: number,
    sourcePaths: string[],
  ) =>
    invoke<string[]>("check_collection_upload_conflicts", {
      collectionId,
      sourcePaths,
    }),
  deleteCollectionTrack: (trackId: number) =>
    invoke<PlaybackState>("delete_collection_track", { trackId }),
  exportCollection: (collectionId: number, destination: string) =>
    invoke<void>("export_collection", { collectionId, destination }),
  importCollection: (source: string) =>
    invoke<number>("import_collection", { source }),
  setCollectionPlaybackMode: (collectionId: number, playbackMode: CollectionPlaybackMode) =>
    invoke<Collection>("set_collection_playback_mode", {
      collectionId,
      playbackMode,
    }),
  setCollectionContinuousVolume: (collectionId: number, continuousVolume: number) =>
    invoke<Collection>("set_collection_continuous_volume", {
      collectionId,
      continuousVolume,
    }),
  getCollectionPlaybackState: (collectionId: number) =>
    invoke<CollectionPlaybackState>("get_collection_playback_state", { collectionId }),
  saveCollectionPlaybackState: (
    collectionId: number,
    trackId: number | null,
    positionMs: number,
  ) =>
    invoke<void>("save_collection_playback_state", {
      collectionId,
      trackId,
      positionMs,
    }),
  createPlaylist: (name: string) =>
    invoke<number>("create_playlist", { name }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  renamePlaylist: (id: number, name: string) =>
    invoke<void>("rename_playlist", { id, name }),
  listPlaylists: () => invoke<Playlist[]>("list_playlists"),
  getPlaylistTracks: (playlistId: number) =>
    invoke<Track[]>("get_playlist_tracks", { playlistId }),
  addTrackToPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("add_track_to_playlist", { playlistId, trackId }),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("remove_track_from_playlist", { playlistId, trackId }),
  reorderPlaylistTracks: (playlistId: number, trackIds: number[]) =>
    invoke<void>("reorder_playlist_tracks", { playlistId, trackIds }),
  reorderPlaylists: (playlistIds: number[]) =>
    invoke<void>("reorder_playlists", { playlistIds }),
  createTaglist: (
    name: string,
    tagKey: string,
    entryTagKey: string,
    valueSingularName: string,
  ) =>
    invoke<number>("create_taglist", {
      name,
      tagKey,
      entryTagKey,
      valueSingularName,
    }),
  deleteTaglist: (id: number) => invoke<void>("delete_taglist", { id }),
  listTaglists: () => invoke<Taglist[]>("list_taglists"),
  listTaglistValues: (taglistId: number) =>
    invoke<TaglistValue[]>("list_taglist_values", { taglistId }),
  importTaglistTitles: (taglistId: number, path: string) =>
    invoke<number>("import_taglist_titles", { taglistId, path }),
  setTaglistValueTitle: (
    taglistId: number,
    tagValue: string,
    displayTitle: string | null,
  ) =>
    invoke<void>("set_taglist_value_title", {
      taglistId,
      tagValue,
      displayTitle,
    }),
  getTaglistTracks: (taglistId: number, value: string | null) =>
    invoke<Track[]>("get_taglist_tracks", { taglistId, value }),
  reorderTaglistTracks: (
    taglistId: number,
    value: string | null,
    trackIds: number[],
  ) => invoke<void>("reorder_taglist_tracks", { taglistId, value, trackIds }),
  reorderTaglistValues: (taglistId: number, tagValues: string[]) =>
    invoke<void>("reorder_taglist_values", { taglistId, tagValues }),
  listTaglistSwapTargets: (
    taglistId: number,
    sourceValue: string | null,
    sourceTrackId: number,
  ) =>
    invoke<TaglistSwapTarget[]>("list_taglist_swap_targets", {
      taglistId,
      sourceValue,
      sourceTrackId,
    }),
  swapTaglistEntries: (
    taglistId: number,
    sourceValue: string | null,
    targetValue: string | null,
    sourceTrackId: number,
  ) =>
    invoke<Track[]>("swap_taglist_entries", {
      taglistId,
      sourceValue,
      targetValue,
      sourceTrackId,
    }),
  playTrack: (trackId: number, startMs?: number, autoplay = true) =>
    invoke<PlaybackState>("play_track", { trackId, startMs, autoplay }),
  pausePlayback: () => invoke<PlaybackState>("pause_playback"),
  resumePlayback: () => invoke<PlaybackState>("resume_playback"),
  stopPlayback: () => invoke<PlaybackState>("stop_playback"),
  seekPlayback: (positionMs: number) =>
    invoke<PlaybackState>("seek_playback", { positionMs }),
  getPlaybackState: () => invoke<PlaybackState>("get_playback_state"),
  getVolume: () => invoke<number>("get_volume"),
  setVolume: (volume: number) => invoke<number>("set_volume", { volume }),
  getTrackPeaks: (trackId: number) =>
    invoke<WaveformPeaks>("get_track_peaks", { trackId }),
  getTrackTags: (trackId: number) =>
    invoke<TrackTagInfo>("get_track_tags", { trackId }),
  updateTrackTags: (
    trackId: number,
    fields: { key: string; value: string }[],
  ) => invoke<Track>("update_track_tags", { trackId, fields }),
  getAppSettings: () => invoke<ThemeSettings>("get_app_settings"),
  setAppSettings: (settings: ThemeSettings) =>
    invoke<ThemeSettings>("set_app_settings", { settings }),
  getApplicationSettings: () =>
    invoke<ApplicationSettings>("get_application_settings"),
  setApplicationSettings: (settings: ApplicationSettings) =>
    invoke<ApplicationSettings>("set_application_settings", { settings }),
};

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
