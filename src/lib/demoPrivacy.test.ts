import { describe, expect, it } from "vitest";

import {
  TAG_KEY_ALBUM_TITLE,
  TAG_KEY_TRACK_ARTIST,
  TAG_KEY_TRACK_TITLE,
  shouldBlurFilename,
  shouldBlurTrackField,
} from "./demoPrivacy";

describe("shouldBlurFilename", () => {
  it("requires demo mode and the filenames option", () => {
    expect(shouldBlurFilename(false, true)).toBe(false);
    expect(shouldBlurFilename(true, false)).toBe(false);
    expect(shouldBlurFilename(true, true)).toBe(true);
  });
});

describe("shouldBlurTrackField", () => {
  it("does not blur when demo mode is off", () => {
    expect(
      shouldBlurTrackField(false, "title", [TAG_KEY_TRACK_TITLE]),
    ).toBe(false);
  });

  it("blurs title when Track Title is sensitive", () => {
    expect(
      shouldBlurTrackField(true, "title", [TAG_KEY_TRACK_TITLE]),
    ).toBe(true);
    expect(
      shouldBlurTrackField(true, "artist", [TAG_KEY_TRACK_TITLE]),
    ).toBe(false);
  });

  it("maps artist and album tag keys to track fields", () => {
    expect(
      shouldBlurTrackField(true, "artist", [TAG_KEY_TRACK_ARTIST]),
    ).toBe(true);
    expect(
      shouldBlurTrackField(true, "album", [TAG_KEY_ALBUM_TITLE]),
    ).toBe(true);
  });
});
