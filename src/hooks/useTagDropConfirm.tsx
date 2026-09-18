import { useCallback, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  TagDropChoiceModal,
  type TagDropChoiceMode,
} from "../components/TagDropChoiceModal";
import { DemoBlurText } from "../components/DemoBlurText";
import { useDemoPrivacy } from "./useDemoPrivacy";
import {
  api,
  type Taglist,
  type TaglistSwapTarget,
  type TaglistValue,
} from "../lib/tauri";
import {
  formatTaglistLabel,
  getTaglistValueSingularLabel,
} from "../lib/taglistLabels";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { useLibrary } from "./usePlayer";
import { usePlayerStore } from "../store/playerStore";

interface PendingTagDrop {
  trackId: number;
  trackTitle: string;
  taglist: Taglist;
  targetValue: string | null;
  targetDisplayTitle?: string | null;
  entryTagValue: string | null;
  sourcePartitionValue: string | null;
  swapPartner?: TaglistSwapTarget;
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

function partitionsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a != null && b != null) return a === b;
  return false;
}

export function useTagDropConfirm() {
  const { shouldBlurTagKey, shouldBlurTrackField } = useDemoPrivacy();
  const { refresh } = useLibrary();
  const tracks = usePlayerStore((state) => state.tracks);
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const [pending, setPending] = useState<PendingTagDrop | null>(null);
  const [dropMode, setDropMode] = useState<TagDropChoiceMode>("swap");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestTagDrop = useCallback(
    async (trackId: number, taglist: Taglist, entry: TaglistValue) => {
      const trackTitle =
        tracks.find((track) => track.id === trackId)?.title ?? "Track";

      let currentValue: string | null = null;
      let entryTagValue: string | null = null;
      try {
        const tagInfo = await api.getTrackTags(trackId);
        const field = tagInfo.fields.find((item) => item.key === taglist.tag_key);
        currentValue = normalizeTagValue(field?.value);
        const entryField = tagInfo.fields.find(
          (item) => item.key === taglist.entry_tag_key,
        );
        entryTagValue = normalizeTagValue(entryField?.value);
      } catch (err) {
        console.error(err);
        return;
      }

      if (tagValuesMatch(currentValue, entry.value)) {
        return;
      }

      let swapPartner: TaglistSwapTarget | undefined;
      if (entry.value != null) {
        try {
          const targets = await api.listTaglistSwapTargets(
            taglist.id,
            currentValue,
            trackId,
          );
          swapPartner = targets.find((target) =>
            partitionsEqual(target.partition_value, entry.value),
          );
        } catch (err) {
          console.error(err);
        }
      }

      setError(null);
      setDropMode(swapPartner ? "swap" : "move");
      setPending({
        trackId,
        trackTitle,
        taglist,
        targetValue: entry.value,
        targetDisplayTitle: entry.display_title,
        entryTagValue,
        sourcePartitionValue: currentValue,
        swapPartner,
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
      if (pending.swapPartner && dropMode === "swap") {
        const updated = await api.swapTaglistEntries(
          pending.taglist.id,
          pending.sourcePartitionValue,
          pending.targetValue,
          pending.trackId,
        );
        for (const track of updated) {
          patchTrack(track);
          invalidateTrackTags(track.id);
        }
      } else {
        const updated = await api.updateTrackTags(pending.trackId, [
          { key: pending.taglist.tag_key, value: pending.targetValue ?? "" },
        ]);
        patchTrack(updated);
        invalidateTrackTags(pending.trackId);
      }
      await refresh();
      setPending(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [dropMode, pending, patchTrack, refresh]);

  const sublistLabel = pending
    ? getTaglistValueSingularLabel(pending.taglist)
    : "";
  const partitionLabel = pending
    ? formatTaglistLabel(pending.targetValue, pending.targetDisplayTitle)
    : "";
  const entryTagKey = pending?.taglist.entry_tag_key.trim() ?? "";
  const blurPartnerTitle =
    shouldBlurTrackField("title") ||
    (entryTagKey.length > 0 && shouldBlurTagKey(entryTagKey));

  const confirmDialog = pending
    ? pending.targetValue != null && pending.swapPartner
      ? (
          <TagDropChoiceModal
            title={`Move to ${sublistLabel}`}
            sublistLabel={sublistLabel}
            partitionLabel={partitionLabel}
            entryTagValue={pending.entryTagValue}
            blurEntryValue={shouldBlurTagKey(
              entryTagKey || pending.taglist.entry_tag_key,
            )}
            blurPartition={shouldBlurTagKey(pending.taglist.tag_key)}
            blurPartnerTitle={blurPartnerTitle}
            swapPartner={pending.swapPartner}
            mode={dropMode}
            onModeChange={setDropMode}
            error={error}
            busy={saving}
            onConfirm={() => void confirmTagDrop()}
            onCancel={cancelTagDrop}
          />
        )
      : (
          <ConfirmDialog
            title={
              pending.targetValue == null
                ? "Remove tag"
                : `Move to ${sublistLabel}`
            }
            message={
              pending.targetValue == null ? (
                <>
                  Remove &ldquo;{pending.taglist.tag_key}&rdquo; from &ldquo;
                  <DemoBlurText blur={shouldBlurTrackField("title")}>
                    {pending.trackTitle}
                  </DemoBlurText>
                  &rdquo;?
                  <br />
                  <br />
                  This updates the file&apos;s metadata.
                  {error ? (
                    <>
                      <br />
                      <br />
                      {error}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Move &ldquo;
                  <DemoBlurText
                    blur={shouldBlurTagKey(
                      entryTagKey || pending.taglist.entry_tag_key,
                    )}
                  >
                    {pending.entryTagValue ?? ""}
                  </DemoBlurText>
                  &rdquo; to {sublistLabel} &ldquo;
                  <DemoBlurText blur={shouldBlurTagKey(pending.taglist.tag_key)}>
                    {partitionLabel}
                  </DemoBlurText>
                  &rdquo;?
                  <br />
                  <br />
                  This updates the file&apos;s metadata.
                  {error ? (
                    <>
                      <br />
                      <br />
                      {error}
                    </>
                  ) : null}
                </>
              )
            }
            confirmLabel={pending.targetValue == null ? "Remove" : "Move"}
            cancelLabel="Cancel"
            busy={saving}
            onConfirm={() => void confirmTagDrop()}
            onCancel={cancelTagDrop}
          />
        )
    : null;

  return {
    requestTagDrop,
    confirmDialog,
  };
}
