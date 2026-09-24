import { DeliveryFolderDropZone } from "./DeliveryFolderDropZone";

export interface DeliveryFolderPickerModalProps {
  title: string;
  description: string;
  chooseButtonLabel: string;
  dropZoneLabel: string;
  enabled: boolean;
  onClose: () => void;
  onChooseFolder: () => void;
  onFolderDropped: (path: string) => void;
}

export function DeliveryFolderPickerModal({
  title,
  description,
  chooseButtonLabel,
  dropZoneLabel,
  enabled,
  onClose,
  onChooseFolder,
  onFolderDropped,
}: DeliveryFolderPickerModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted">{description}</p>
        </div>

        <div className="space-y-3 px-4 py-4">
          <button
            type="button"
            disabled={!enabled}
            onClick={onChooseFolder}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-40"
          >
            {chooseButtonLabel}
          </button>
          <DeliveryFolderDropZone
            label={dropZoneLabel}
            enabled={enabled}
            onFolderDropped={onFolderDropped}
          />
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
