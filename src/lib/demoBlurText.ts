export const DEMO_BLUR_FILTER = "blur(6px)";

export type DemoBlurSegment =
  | { kind: "clear"; text: string }
  | { kind: "blur"; text: string };

export function splitDemoBlurSegments(text: string): DemoBlurSegment[] {
  if (text.length === 0) {
    return [];
  }

  const segments: DemoBlurSegment[] = [];
  const parts = text.match(/(\s+|[^\s]+)/g);
  if (!parts) {
    return [{ kind: "clear", text }];
  }

  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      segments.push({ kind: "clear", text: part });
      continue;
    }

    segments.push({ kind: "clear", text: part[0] });
    if (part.length > 1) {
      segments.push({ kind: "blur", text: part.slice(1) });
    }
  }

  return segments;
}
