export const TRACK_DRAG_MIME = "application/x-trackvault-track-id";
export const REORDER_DRAG_MIME = "application/x-trackvault-reorder-index";
export const SUBLIST_REORDER_DRAG_MIME =
  "application/x-trackvault-sublist-reorder-index";
const TRACK_DRAG_TEXT_PREFIX = "trackvault:";

export function setTrackDragData(dataTransfer: DataTransfer, trackId: number): void {
  dataTransfer.setData(TRACK_DRAG_MIME, String(trackId));
  dataTransfer.setData("text/plain", `${TRACK_DRAG_TEXT_PREFIX}${trackId}`);
  dataTransfer.effectAllowed = "copy";
}

export function setReorderDragData(dataTransfer: DataTransfer, index: number): void {
  dataTransfer.setData(REORDER_DRAG_MIME, String(index));
  dataTransfer.effectAllowed = "move";
}

export function getReorderDragData(dataTransfer: DataTransfer): number | null {
  const raw = dataTransfer.getData(REORDER_DRAG_MIME);
  if (!raw) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isFinite(index) ? index : null;
}

export function setSublistReorderDragData(
  dataTransfer: DataTransfer,
  index: number,
): void {
  dataTransfer.setData(SUBLIST_REORDER_DRAG_MIME, String(index));
  dataTransfer.effectAllowed = "move";
}

export function getSublistReorderDragData(
  dataTransfer: DataTransfer,
): number | null {
  const raw = dataTransfer.getData(SUBLIST_REORDER_DRAG_MIME);
  if (!raw) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isFinite(index) ? index : null;
}

function parseTrackId(raw: string): number | null {
  const trackId = Number.parseInt(raw, 10);
  return Number.isFinite(trackId) ? trackId : null;
}

export function getTrackDragData(dataTransfer: DataTransfer): number | null {
  const custom = dataTransfer.getData(TRACK_DRAG_MIME);
  if (custom) {
    const trackId = parseTrackId(custom);
    if (trackId != null) return trackId;
  }

  const plain = dataTransfer.getData("text/plain");
  if (plain.startsWith(TRACK_DRAG_TEXT_PREFIX)) {
    return parseTrackId(plain.slice(TRACK_DRAG_TEXT_PREFIX.length));
  }

  return null;
}

export function isTrackDrag(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes(TRACK_DRAG_MIME) ||
    dataTransfer.types.includes("text/plain")
  );
}

export function isReorderDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(REORDER_DRAG_MIME);
}

export function isSublistReorderDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(SUBLIST_REORDER_DRAG_MIME);
}

export function reorderItemsByIndex<T>(
  items: T[],
  fromIndex: number,
  toIndex: number,
  position: "before" | "after",
): T[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  let insertAt = toIndex;
  if (position === "after") insertAt += 1;
  if (fromIndex < insertAt) insertAt -= 1;
  next.splice(insertAt, 0, moved);
  return next;
}
