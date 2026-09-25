import { describe, expect, it } from "vitest";

import type { PlaybackState } from "../lib/tauri";
import {
  getContextTrackId,
  isProjectSourcedView,
  mergeBackendPlaybackState,
  serializeView,
  shouldClearPositionGuard,
  viewsEqual,
} from "./playerStore";

function playback(
  positionMs: number,
  isPlaying: boolean,
): PlaybackState {
  return {
    track_id: 1,
    position_ms: positionMs,
    duration_ms: 300_000,
    is_playing: isPlaying,
  };
}

describe("shouldClearPositionGuard", () => {
  const guardTarget = 120_000;

  it("accepts positions within tolerance of the seek target", () => {
    expect(shouldClearPositionGuard(guardTarget, playback(120_050, true))).toBe(
      true,
    );
    expect(
      shouldClearPositionGuard(guardTarget, playback(119_950, false)),
    ).toBe(true);
  });

  it("accepts forward progress while playing (regression for playhead freeze)", () => {
    expect(shouldClearPositionGuard(guardTarget, playback(120_150, true))).toBe(
      true,
    );
    expect(shouldClearPositionGuard(guardTarget, playback(125_000, true))).toBe(
      true,
    );
  });

  it("rejects stale pre-seek positions", () => {
    expect(shouldClearPositionGuard(guardTarget, playback(50_000, true))).toBe(
      false,
    );
    expect(
      shouldClearPositionGuard(guardTarget, playback(119_800, true)),
    ).toBe(false);
  });

  it("rejects far-ahead positions while paused", () => {
    expect(
      shouldClearPositionGuard(guardTarget, playback(120_150, false)),
    ).toBe(false);
  });
});

describe("mergeBackendPlaybackState", () => {
  it("preserves position when paused and emitter reports stale zero", () => {
    const existing = playback(120_000, false);
    const incoming = playback(0, false);

    const merged = mergeBackendPlaybackState(existing, incoming);

    expect(merged.position_ms).toBe(120_000);
    expect(merged.is_playing).toBe(false);
  });

  it("accepts live position updates while playing", () => {
    const existing = playback(120_000, true);
    const incoming = playback(121_000, true);

    const merged = mergeBackendPlaybackState(existing, incoming);

    expect(merged.position_ms).toBe(121_000);
    expect(merged.is_playing).toBe(true);
  });

  it("updates is_playing while preserving paused position", () => {
    const existing = playback(120_000, false);
    const incoming = playback(0, false);

    expect(mergeBackendPlaybackState(existing, incoming).is_playing).toBe(false);
  });
});

describe("view helpers", () => {
  it("identifies project-sourced views", () => {
    expect(isProjectSourcedView("project_tracks")).toBe(true);
    expect(isProjectSourcedView({ playlistId: 1 })).toBe(true);
    expect(isProjectSourcedView({ taglistId: 2, value: "rock" })).toBe(true);
    expect(isProjectSourcedView({ collectionId: 3 })).toBe(false);
  });

  it("serializes and compares views", () => {
    expect(serializeView("project_tracks")).toBe("project_tracks");
    expect(serializeView({ playlistId: 4 })).toBe("playlist:4");
    expect(serializeView({ taglistId: 5, value: null })).toBe("taglist:5:");
    expect(serializeView({ taglistId: 5, value: "jazz" })).toBe("taglist:5:jazz");
    expect(serializeView({ collectionId: 6 })).toBe("collection:6");

    expect(viewsEqual("project_tracks", "project_tracks")).toBe(true);
    expect(viewsEqual({ playlistId: 1 }, { playlistId: 1 })).toBe(true);
    expect(
      viewsEqual({ taglistId: 1, value: "a" }, { taglistId: 1, value: "b" }),
    ).toBe(false);
  });
});

describe("getContextTrackId", () => {
  const basePlayback: PlaybackState = {
    track_id: 10,
    position_ms: 0,
    duration_ms: 1000,
    is_playing: false,
  };

  it("prefers cursor while a track load is in progress", () => {
    expect(
      getContextTrackId({
        playback: basePlayback,
        cursorTrackId: 20,
        transportMode: "load",
      }),
    ).toBe(20);
  });

  it("falls back to playback then cursor when idle", () => {
    expect(
      getContextTrackId({
        playback: basePlayback,
        cursorTrackId: 20,
        transportMode: "idle",
      }),
    ).toBe(10);

    expect(
      getContextTrackId({
        playback: { ...basePlayback, track_id: null },
        cursorTrackId: 20,
        transportMode: "idle",
      }),
    ).toBe(20);
  });
});
