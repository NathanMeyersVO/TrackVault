import { describe, expect, it } from "vitest";

import { splitDemoBlurSegments } from "./demoBlurText";

function segmentTexts(segments: ReturnType<typeof splitDemoBlurSegments>) {
  return segments.map((s) => `${s.kind}:${s.text}`);
}

describe("splitDemoBlurSegments", () => {
  it("returns nothing for empty string", () => {
    expect(splitDemoBlurSegments("")).toEqual([]);
  });

  it("keeps a single character clear only", () => {
    expect(splitDemoBlurSegments("A")).toEqual([{ kind: "clear", text: "A" }]);
  });

  it("blurs all but the first character of one word", () => {
    expect(splitDemoBlurSegments("Hello")).toEqual([
      { kind: "clear", text: "H" },
      { kind: "blur", text: "ello" },
    ]);
  });

  it("handles multiple words and preserves whitespace", () => {
    expect(segmentTexts(splitDemoBlurSegments("Hi there"))).toEqual([
      "clear:H",
      "blur:i",
      "clear: ",
      "clear:t",
      "blur:here",
    ]);
  });

  it("treats punctuation as part of the word", () => {
    expect(segmentTexts(splitDemoBlurSegments("Hello, world"))).toEqual([
      "clear:H",
      "blur:ello,",
      "clear: ",
      "clear:w",
      "blur:orld",
    ]);
  });
});
