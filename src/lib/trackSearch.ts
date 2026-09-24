import type { Track } from "./tauri";

export function filterTracksByTitle(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter((t) => t.title.toLowerCase().includes(q));
}
