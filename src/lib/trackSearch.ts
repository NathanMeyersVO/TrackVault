import type { Track } from "./tauri";

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function fileStemFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function trackMatchesProjectLibraryQuery(
  track: Track,
  query: string,
  entryTagKey: string | null,
  entryTagValue: string | null | undefined,
): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;

  if (entryTagKey != null) {
    if (entryTagValue == null) return false;
    return normalizeSearchText(entryTagValue).includes(needle);
  }

  const stem = fileStemFromPath(track.path);
  return normalizeSearchText(stem).includes(needle);
}

export function filterTracksByProjectLibraryQuery(
  tracks: Track[],
  query: string,
  matchingTrackIds: ReadonlySet<number>,
): Track[] {
  const needle = query.trim();
  if (!needle) return tracks;
  if (matchingTrackIds.size === 0) return [];
  return tracks.filter((track) => matchingTrackIds.has(track.id));
}
