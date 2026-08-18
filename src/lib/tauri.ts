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

export const api = {
  listTracks: () => invoke<Track[]>("list_tracks"),
  listWatchFolders: () => invoke<string[]>("list_watch_folders"),
  addWatchFolder: (path: string) =>
    invoke<ScanProgress>("add_watch_folder", { path }),
  scanLibrary: () => invoke<ScanProgress>("scan_library"),
  createPlaylist: (name: string) =>
    invoke<number>("create_playlist", { name }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  listPlaylists: () => invoke<Playlist[]>("list_playlists"),
  getPlaylistTracks: (playlistId: number) =>
    invoke<Track[]>("get_playlist_tracks", { playlistId }),
  addTrackToPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("add_track_to_playlist", { playlistId, trackId }),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>("remove_track_from_playlist", { playlistId, trackId }),
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
};

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
