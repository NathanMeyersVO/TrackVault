import type { Track } from "./tauri";

export const TAG_KEY_TRACK_TITLE = "Track Title";
export const TAG_KEY_TRACK_ARTIST = "Track Artist";
export const TAG_KEY_ALBUM_TITLE = "Album Title";

export type TrackDisplayField = "title" | "artist" | "album";

export const TRACK_FIELD_BY_TAG_KEY: Record<string, TrackDisplayField> = {
  [TAG_KEY_TRACK_TITLE]: "title",
  [TAG_KEY_TRACK_ARTIST]: "artist",
  [TAG_KEY_ALBUM_TITLE]: "album",
};

export function isSensitiveTagKey(
  tagKey: string,
  sensitiveTagKeys: readonly string[],
): boolean {
  const trimmed = tagKey.trim();
  return sensitiveTagKeys.some((key) => key === trimmed);
}

export function shouldBlurTagKey(
  demoModeEnabled: boolean,
  tagKey: string,
  sensitiveTagKeys: readonly string[],
): boolean {
  return demoModeEnabled && isSensitiveTagKey(tagKey, sensitiveTagKeys);
}

export function shouldBlurTrackField(
  demoModeEnabled: boolean,
  field: TrackDisplayField,
  sensitiveTagKeys: readonly string[],
): boolean {
  if (!demoModeEnabled) return false;
  return sensitiveTagKeys.some(
    (key) => TRACK_FIELD_BY_TAG_KEY[key.trim()] === field,
  );
}

export function shouldBlurFilename(
  demoModeEnabled: boolean,
  blurFilenames: boolean,
): boolean {
  return demoModeEnabled && blurFilenames;
}

export function getTrackFieldValue(
  track: Pick<Track, "title" | "artist" | "album">,
  field: TrackDisplayField,
): string {
  switch (field) {
    case "title":
      return track.title;
    case "artist":
      return track.artist;
    case "album":
      return track.album;
  }
}
