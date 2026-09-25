import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AudioFilesDropZone } from "./AudioFilesDropZone";
import {
  UploadTracksPhoneSection,
  type UploadTracksPhoneMode,
} from "./UploadTracksPhoneSection";
import { AUDIO_FILE_DIALOG_FILTER } from "../lib/audioExtensions";
import { trackDeliveryIntro } from "../lib/trackDeliveryCopy";
import { api } from "../lib/tauri";
import { TrackDeliveryOptionSection } from "./TrackDeliveryOptionSection";

export interface UploadTracksModalProps {
  mode: UploadTracksPhoneMode;
  collectionId?: number;
  collectionName?: string | null;
  phoneUploadReady: boolean;
  enabled: boolean;
  uploading: boolean;
  onClose: () => void;
  onUploadFromPaths: (paths: string[]) => Promise<boolean>;
  onPhoneUploaded: (message: string) => void;
}

export function UploadTracksModal({
  mode,
  collectionId,
  collectionName,
  phoneUploadReady,
  enabled,
  uploading,
  onClose,
  onUploadFromPaths,
  onPhoneUploaded,
}: UploadTracksModalProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);

  const title =
    mode === "library"
      ? "Upload to project library"
      : collectionName
        ? `Upload to ${collectionName}`
        : "Upload to stored collection";

  const busy = uploading || phoneBusy;
  const deliveryOptions = phoneUploadReady ? 3 : 2;
  const destinationHint =
    mode === "library"
      ? "Files are copied into your project library folder."
      : "Files are copied into this stored collection.";

  const handleClose = useCallback(() => {
    if (busy) return;
    void api.stopReplaceRemoteUpload();
    void api.cleanupDropStaging();
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, handleClose]);

  const runLocalPaths = useCallback(
    async (paths: string[], fromDragDrop: boolean) => {
      setLocalError(null);
      try {
        const staged = fromDragDrop
          ? await api.stageDropSourcePaths(paths, true)
          : paths;
        const ok = await onUploadFromPaths(staged);
        if (ok) {
          void api.stopReplaceRemoteUpload();
          onClose();
        }
      } catch (err) {
        setLocalError(String(err));
      }
    },
    [onClose, onUploadFromPaths],
  );

  const chooseFiles = useCallback(async () => {
    if (!enabled || busy) return;
    const selected = await open({
      multiple: true,
      title: "Choose audio files to upload",
      filters: [AUDIO_FILE_DIALOG_FILTER],
    });
    if (selected == null) return;
    const sourcePaths = Array.isArray(selected) ? selected : [selected];
    await runLocalPaths(sourcePaths, false);
  }, [busy, enabled, runLocalPaths]);

  const handlePhoneUploaded = useCallback(
    (message: string) => {
      onPhoneUploaded(message);
      onClose();
    },
    [onClose, onPhoneUploaded],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-tracks-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="upload-tracks-title" className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-foreground">
          <div className="space-y-1 text-xs text-muted">
            <p className="text-sm text-foreground">
              {trackDeliveryIntro(deliveryOptions, true)}
            </p>
            <p>{destinationHint}</p>
          </div>

          <TrackDeliveryOptionSection title="Choose files">
            <button
              type="button"
              disabled={!enabled || busy}
              onClick={() => void chooseFiles()}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Choose files…"}
            </button>
          </TrackDeliveryOptionSection>

          <TrackDeliveryOptionSection title="Drag and drop">
            <AudioFilesDropZone
              label="Drop audio files here"
              enabled={enabled && !busy}
              multiple
              onAudioPathsDropped={(paths) => void runLocalPaths(paths, true)}
              onRejected={() =>
                setLocalError("Drop audio files only (mp3, flac, wav, and similar formats).")
              }
            />
            {localError && <p className="text-sm text-red-400">{localError}</p>}
          </TrackDeliveryOptionSection>

          {phoneUploadReady ? (
            <TrackDeliveryOptionSection title="Upload from phone">
              <UploadTracksPhoneSection
                mode={mode}
                collectionId={collectionId}
                collectionName={collectionName}
                enabled={enabled && !uploading}
                onUploaded={handlePhoneUploaded}
                onBusyChange={setPhoneBusy}
              />
            </TrackDeliveryOptionSection>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-foreground hover:bg-surface-hover disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
