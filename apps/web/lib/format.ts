export function formatDateTime(
  value: string | undefined,
): string {
  if (!value) return "Not provided";

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) return value;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
