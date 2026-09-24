export interface DeliveryBusyOverlayProps {
  title: string;
  detail?: string;
}

export function DeliveryBusyOverlay({ title, detail }: DeliveryBusyOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-busy="true"
      aria-label={title}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface px-5 py-4 shadow-xl">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-hover">
          <div className="tv-indeterminate-bar h-full w-1/3 bg-accent" />
        </div>
      </div>
    </div>
  );
}
