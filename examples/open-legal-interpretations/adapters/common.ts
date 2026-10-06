import {
  stableSlug,
} from "@civic-registry/source-adapters";

const MONTHS = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

export function parseUsDate(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;

  const match = value.match(
    /\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/,
  );

  if (!match) return undefined;

  const month = MONTHS.get(
    match[1].toLowerCase(),
  );

  if (!month) return undefined;

  const day = Number(match[2]);
  const year = Number(match[3]);

  if (
    day < 1 ||
    day > 31 ||
    year < 1900 ||
    year > 3000
  ) {
    return undefined;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function uniqueStrings(
  values: Array<string | undefined>,
): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter(
          (value): value is string =>
            Boolean(value),
        ),
    ),
  ];
}

export function summarize(
  value: string | undefined,
  maxLength = 1200,
): string | undefined {
  if (!value) return undefined;

  const text = value
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return undefined;

  if (text.length <= maxLength) {
    return text;
  }

  return (
    text.slice(0, maxLength - 1).trimEnd() +
    "…"
  );
}

export function stableRecordId(
  prefix: string,
  value: string,
): string {
  return (
    prefix +
    "-" +
    stableSlug(value)
  ).slice(0, 180);
}
