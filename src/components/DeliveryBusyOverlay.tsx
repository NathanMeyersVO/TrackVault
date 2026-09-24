import {
  deliveryProgressPercent,
  formatDeliveryProgressDetail,
} from "../lib/deliveryProgress";
import type { DeliveryProgress } from "../lib/tauri";

export interface DeliveryBusyOverlayProps {
  title: string;
  detail?: string;
  progress?: DeliveryProgress | null;
  percent?: number | null;
}

export function DeliveryBusyOverlay({
  title,
  detail,
  progress,
  percent: percentProp,
}: DeliveryBusyOverlayProps) {
  const progressDetail = formatDeliveryProgressDetail(progress ?? null);
  const line = progressDetail ?? detail;
  const percent =
    percentProp !== undefined ? percentProp : deliveryProgressPercent(progress ?? null);
  const determinate = percent != null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-busy="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface px-5 py-4 shadow-xl">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {line ? (
          <p className="mt-1 break-all text-xs text-muted">{line}</p>
        ) : null}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover">
            {determinate ? (
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="tv-indeterminate-bar h-full w-1/3 bg-accent" />
            )}
          </div>
          {determinate ? (
            <span className="shrink-0 text-xs tabular-nums text-muted">{percent}%</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
