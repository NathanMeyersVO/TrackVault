export function formatTaglistLabel(
  value: string | null,
  displayTitle?: string | null,
): string {
  if (value == null) return "NO-TAG";
  if (displayTitle) return `${value} - ${displayTitle}`;
  return value;
}

export function getTaglistValueSingularLabel(taglist: {
  name: string;
  value_singular_name: string;
}): string {
  const trimmed = taglist.value_singular_name.trim();
  return trimmed || taglist.name;
}
