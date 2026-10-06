export type RelationshipQueryParams = Record<
  string,
  string | string[] | undefined
>;

export function firstRelationshipValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function relationshipValues(
  value: string | string[] | undefined,
): string[] {
  const values = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  return [
    ...new Set(
      values
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function relationshipDirectionParam(
  value: string | string[] | undefined,
):
  | "outbound"
  | "inbound"
  | "undirected"
  | undefined {
  const direction = firstRelationshipValue(value);

  if (
    direction === "outbound" ||
    direction === "inbound" ||
    direction === "undirected"
  ) {
    return direction;
  }

  return undefined;
}

export function relationshipDepthParam(
  value: string | string[] | undefined,
): number {
  const raw = firstRelationshipValue(value);
  const parsed = raw
    ? Number.parseInt(raw, 10)
    : 1;

  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(3, parsed));
}
