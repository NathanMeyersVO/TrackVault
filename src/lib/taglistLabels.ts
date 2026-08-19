export function formatTaglistLabel(
  value: string | null,
  displayTitle?: string | null,
): string {
  if (value == null) return "NO-TAG";
  if (displayTitle) return `${value} - ${displayTitle}`;
  return value;
}
