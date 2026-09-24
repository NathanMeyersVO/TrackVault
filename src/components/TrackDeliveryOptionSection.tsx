import type { ReactNode } from "react";

interface TrackDeliveryOptionSectionProps {
  title: string;
  children: ReactNode;
}

export function TrackDeliveryOptionSection({
  title,
  children,
}: TrackDeliveryOptionSectionProps) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-background/30 p-3">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}
