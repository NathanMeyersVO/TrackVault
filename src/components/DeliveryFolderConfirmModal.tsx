import type { DeliveryBrowseEntry, DeliveryEntryKind, DeliveryFolderBrowseResult } from "../lib/tauri";

export interface DeliveryFolderConfirmModalProps {
  title: string;
  supportsScheduleDelivery: boolean;
  browse: DeliveryFolderBrowseResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onChooseDifferent: () => void;
  onConfirm: (folderPath: string) => void;
}

const KIND_LABEL: Record<DeliveryEntryKind, string> = {
  folder: "Folder",
  archive: "Archive",
  schedule: "Schedule",
  audio: "Audio",
  other: "File",
};

function EntryRow({ entry }: { entry: DeliveryBrowseEntry }) {
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1 text-sm">
      <span className="w-16 shrink-0 text-xs text-muted">{KIND_LABEL[entry.kind]}</span>
      <span
        className={`min-w-0 truncate ${
          entry.kind === "other" ? "text-muted" : "text-foreground"
        }`}
      >
        {entry.name}
      </span>
    </li>
  );
}

export function DeliveryFolderConfirmModal({
  title,
  supportsScheduleDelivery,
  browse,
  loading,
  error,
  onClose,
  onChooseDifferent,
  onConfirm,
}: DeliveryFolderConfirmModalProps) {
  const summary = browse?.summary;
  const canImport =
    summary &&
    (summary.archives.length > 0 ||
      summary.audio_files.length > 0 ||
      (supportsScheduleDelivery && summary.schedules.length > 0));
  const nothingRecognizedMessage = supportsScheduleDelivery
    ? "Nothing recognized to import here. Pick a folder that contains archives, audio, or a schedule spreadsheet."
    : "Nothing recognized to import here. Pick a folder that contains audio archives or loose audio files.";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted" title={browse?.path}>
            {browse?.path ?? "…"}
          </p>
        </div>

        <div className="min-h-[10rem] flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">Reading folder…</p>
              <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
                <div className="tv-indeterminate-bar h-full w-1/3 bg-accent" />
              </div>
            </div>
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            <>
              {summary ? (
                <p className="mb-3 text-xs text-muted">
                  <span className="text-foreground">Found in this folder (including subfolders): </span>
                  {summary.archives.length > 0
                    ? `${summary.archives.length} archive(s)`
                    : "no archives"}
                  {" · "}
                  {summary.schedules.length > 0
                    ? `${summary.schedules.length} schedule file(s)`
                    : "no schedule"}
                  {" · "}
                  {summary.audio_files.length > 0
                    ? `${summary.audio_files.length} loose audio file(s)`
                    : "no loose audio"}
                  {!canImport ? (
                    <span className="mt-1 block text-red-400">{nothingRecognizedMessage}</span>
                  ) : null}
                </p>
              ) : null}
              <p className="mb-1 text-xs font-medium text-foreground">Top-level contents</p>
              <ul className="space-y-0.5">
                {browse?.entries.map((entry) => (
                  <EntryRow key={entry.path} entry={entry} />
                ))}
                {browse && browse.entries.length === 0 ? (
                  <li className="py-2 text-xs text-muted">This folder is empty.</li>
                ) : null}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onChooseDifferent}
            className="rounded-md px-3 py-1.5 text-sm text-accent hover:bg-surface-hover disabled:opacity-40"
          >
            Choose different folder…
          </button>
          <button
            type="button"
            disabled={!canImport || loading || !browse}
            onClick={() => browse && onConfirm(browse.path)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
