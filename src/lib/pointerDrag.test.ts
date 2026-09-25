import { describe, expect, it } from "vitest";

import {
  dropPosition,
  pointerExceededDragThreshold,
  scrollDeltaForPointer,
} from "./pointerDrag";

describe("dropPosition", () => {
  const rect = { top: 100, height: 40 } as DOMRect;

  it("returns before when pointer is in the top half", () => {
    expect(dropPosition(110, rect)).toBe("before");
  });

  it("returns after when pointer is in the bottom half", () => {
    expect(dropPosition(130, rect)).toBe("after");
  });
});

describe("scrollDeltaForPointer", () => {
  const rect = { top: 0, bottom: 400 };

  it("does not scroll when the pointer is in the middle", () => {
    expect(scrollDeltaForPointer(200, rect)).toBe(0);
  });

  it("scrolls up near the top edge", () => {
    expect(scrollDeltaForPointer(8, rect)).toBeLessThan(0);
  });

  it("scrolls down near the bottom edge", () => {
    expect(scrollDeltaForPointer(390, rect)).toBeGreaterThan(0);
  });

  it("scrolls faster deeper into the edge band", () => {
    const shallow = Math.abs(scrollDeltaForPointer(30, rect));
    const deep = Math.abs(scrollDeltaForPointer(0, rect));
    expect(deep).toBeGreaterThan(shallow);
  });
});

describe("pointerExceededDragThreshold", () => {
  it("is false for small movement", () => {
    expect(pointerExceededDragThreshold(0, 0, 2, 2)).toBe(false);
  });

  it("is true when horizontal movement exceeds threshold", () => {
    expect(pointerExceededDragThreshold(0, 0, 5, 0)).toBe(true);
  });
});
