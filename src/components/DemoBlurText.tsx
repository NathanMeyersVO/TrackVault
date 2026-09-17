import type { ReactNode } from "react";

import { DEMO_BLUR_FILTER, splitDemoBlurSegments } from "../lib/demoBlurText";

interface DemoBlurTextProps {
  blur: boolean;
  children: ReactNode;
  className?: string;
}

export function DemoBlurText({ blur, children, className }: DemoBlurTextProps) {
  if (!blur) {
    return <span className={className}>{children}</span>;
  }

  if (typeof children !== "string" && typeof children !== "number") {
    return (
      <span
        className={`inline-block max-w-full select-none align-bottom ${className ?? ""}`}
        style={{ filter: DEMO_BLUR_FILTER }}
        aria-label="Hidden in demo mode"
      >
        {children}
      </span>
    );
  }

  const text = String(children);
  const segments = splitDemoBlurSegments(text);

  return (
    <span
      className={`max-w-full select-none align-bottom ${className ?? ""}`}
      aria-label="Hidden in demo mode"
    >
      {segments.map((segment, index) =>
        segment.kind === "clear" ? (
          segment.text
        ) : (
          <span key={index} style={{ filter: DEMO_BLUR_FILTER }}>
            {segment.text}
          </span>
        ),
      )}
    </span>
  );
}
