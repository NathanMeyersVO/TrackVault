import type { ReactNode } from "react";

interface DemoBlurTextProps {
  blur: boolean;
  children: ReactNode;
  className?: string;
}

export function DemoBlurText({ blur, children, className }: DemoBlurTextProps) {
  if (!blur) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span
      className={`inline-block max-w-full select-none align-bottom ${className ?? ""}`}
      style={{ filter: "blur(6px)" }}
      aria-label="Hidden in demo mode"
    >
      {children}
    </span>
  );
}
