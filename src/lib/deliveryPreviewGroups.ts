import type { DeliveryChange, DeliveryChangeKind } from "./tauri";

export interface DeliveryChangeGroupDef {
  key: string;
  label: string;
  kinds: DeliveryChangeKind[];
}

export const DELIVERY_CHANGE_GROUPS: DeliveryChangeGroupDef[] = [
  { key: "Added", label: "New tracks added", kinds: ["audio_add"] },
  { key: "Removed", label: "Tracks removed", kinds: ["audio_remove"] },
  { key: "Replaced", label: "Audio replaced", kinds: ["audio_replace"] },
  { key: "Updated", label: "Metadata updated", kinds: ["audio_update"] },
  { key: "Moved", label: "Tracks moved", kinds: ["audio_move"] },
  {
    key: "Schedule",
    label: "Schedule events",
    kinds: ["schedule_event_add", "schedule_event_update", "schedule_event_remove"],
  },
];

export function groupDeliveryChanges(
  changes: DeliveryChange[],
): { def: DeliveryChangeGroupDef; items: DeliveryChange[] }[] {
  const byKind = new Map<DeliveryChangeKind, DeliveryChange[]>();
  for (const change of changes) {
    const list = byKind.get(change.kind) ?? [];
    list.push(change);
    byKind.set(change.kind, list);
  }

  return DELIVERY_CHANGE_GROUPS.map((def) => ({
    def,
    items: def.kinds.flatMap((kind) => byKind.get(kind) ?? []),
  })).filter((g) => g.items.length > 0);
}

export function groupSelectionState(
  items: DeliveryChange[],
  selected: Set<string>,
): { all: boolean; some: boolean; none: boolean } {
  if (items.length === 0) {
    return { all: false, some: false, none: true };
  }
  let count = 0;
  for (const item of items) {
    if (selected.has(item.change_id)) count += 1;
  }
  return {
    all: count === items.length,
    some: count > 0 && count < items.length,
    none: count === 0,
  };
}

/** Collapse large groups by default. */
export const COLLAPSE_GROUP_THRESHOLD = 5;
