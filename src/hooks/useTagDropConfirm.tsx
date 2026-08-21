import { useCallback, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { api, type Taglist, type TaglistValue } from "../lib/tauri";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

interface PendingTagDrop {
  trackId: number;
  trackTitle: string;
  taglist: Taglist;
  targetValue: string | null;
}

function normalizeTagValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function tagValuesMatch(
  current: string | null,
  target: string | null,
): boolean {
  return normalizeTagValue(current) === normalizeTagValue(target);
}

export function useTagDropConfirm() {
  const { refresh } = useLibrary();
  const tracks = usePlayerStore((state) => state.tracks);
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const [pending, setPending] = useState<PendingTagDrop | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestTagDrop = useCallback(
    async (trackId: number, taglist: Taglist, entry: TaglistValue) => {
      const trackTitle =
        tracks.find((track) => track.id === trackId)?.title ?? "Track";

      let currentValue: string | null = null;
      try {
        const tagInfo = await api.getTrackTags(trackId);
        const field = tagInfo.fields.find((item) => item.key === taglist.tag_key);
        currentValue = normalizeTagValue(field?.value);
      } catch (err) {
        console.error(err);
        return;
      }

      if (tagValuesMatch(currentValue, entry.value)) {
        return;
      }

      setError(null);
      setPending({
        trackId,
        trackTitle,
        taglist,
        targetValue: entry.value,
      });
    },
    [tracks],
  );

  const cancelTagDrop = useCallback(() => {
    if (saving) return;
    setPending(null);
    setError(null);
  }, [saving]);

  const confirmTagDrop = useCallback(async () => {
    if (!pending) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTrackTags(pending.trackId, [
        { key: pending.taglist.tag_key, value: pending.targetValue ?? "" },
      ]);
      patchTrack(updated);
      invalidateTrackTags(pending.trackId);
      await refresh();
      setPending(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [pending, patchTrack, refresh]);

  const confirmDialog = pending ? (
    <ConfirmDialog
      title={pending.targetValue == null ? "Remove tag" : "Set tag"}
      message={
        pending.targetValue == null
          ? `Remove "${pending.taglist.tag_key}" from "${pending.trackTitle}"?\n\nThis updates the file's metadata.${error ? `\n\n${error}` : ""}`
          : `Set tag "${pending.taglist.tag_key}" on "${pending.trackTitle}" to "${pending.targetValue}"?\n\nThis updates the file's metadata.${error ? `\n\n${error}` : ""}`
      }
      confirmLabel={pending.targetValue == null ? "Remove" : "Set tag"}
      cancelLabel="Cancel"
      busy={saving}
      onConfirm={() => void confirmTagDrop()}
      onCancel={cancelTagDrop}
    />
  ) : null;

  return {
    requestTagDrop,
    confirmDialog,
  };
}
