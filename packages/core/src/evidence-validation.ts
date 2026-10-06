import {
  SOURCE_TYPES,
  VISIBILITY_LEVELS,
  type Citation,
  type Document,
  type RegistryDefinition,
  type RegistryRecord,
  type Source,
} from "./domain.ts";
import {
  DomainValidationError,
  type ValidationIssue,
} from "./validation.ts";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value))
  );
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validVisibility(value: unknown): boolean {
  return VISIBILITY_LEVELS.includes(
    value as (typeof VISIBILITY_LEVELS)[number],
  );
}

export function validateSource(
  source: Source,
  registryId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!nonEmpty(source.id)) {
    issues.push({
      path: "source.id",
      code: "required_string",
      message: "Source id must be a non-empty string.",
    });
  }

  if (source.registryId !== registryId) {
    issues.push({
      path: "source.registryId",
      code: "registry_mismatch",
      message: `Source registryId must equal ${registryId}.`,
    });
  }

  if (!nonEmpty(source.title)) {
    issues.push({
      path: "source.title",
      code: "required_string",
      message: "Source title must be a non-empty string.",
    });
  }

  if (!SOURCE_TYPES.includes(source.sourceType)) {
    issues.push({
      path: "source.sourceType",
      code: "invalid_source_type",
      message: `Unsupported source type: ${String(source.sourceType)}.`,
    });
  }

  if (!validVisibility(source.visibility)) {
    issues.push({
      path: "source.visibility",
      code: "invalid_visibility",
      message: `Unsupported visibility: ${String(source.visibility)}.`,
    });
  }

  if (
    source.canonicalUrl !== undefined &&
    !httpUrl(source.canonicalUrl)
  ) {
    issues.push({
      path: "source.canonicalUrl",
      code: "invalid_url",
      message: "canonicalUrl must use http or https.",
    });
  }

  for (const [field, value] of [
    ["publishedAt", source.publishedAt],
    ["retrievedAt", source.retrievedAt],
    ["createdAt", source.createdAt],
  ] as const) {
    if (
      (field === "createdAt" || value !== undefined) &&
      !isoDateTime(value)
    ) {
      issues.push({
        path: `source.${field}`,
        code: "invalid_datetime",
        message: `${field} must be an ISO-compatible date-time.`,
      });
    }
  }

  return issues;
}

export function validateDocument(
  document: Document,
  registryId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!nonEmpty(document.id)) {
    issues.push({
      path: "document.id",
      code: "required_string",
      message: "Document id must be a non-empty string.",
    });
  }

  if (document.registryId !== registryId) {
    issues.push({
      path: "document.registryId",
      code: "registry_mismatch",
      message: `Document registryId must equal ${registryId}.`,
    });
  }

  if (!nonEmpty(document.title)) {
    issues.push({
      path: "document.title",
      code: "required_string",
      message: "Document title must be a non-empty string.",
    });
  }

  if (!validVisibility(document.visibility)) {
    issues.push({
      path: "document.visibility",
      code: "invalid_visibility",
      message: `Unsupported visibility: ${String(document.visibility)}.`,
    });
  }

  if (
    document.canonicalUrl !== undefined &&
    !httpUrl(document.canonicalUrl)
  ) {
    issues.push({
      path: "document.canonicalUrl",
      code: "invalid_url",
      message: "canonicalUrl must use http or https.",
    });
  }

  if (
    document.sha256 !== undefined &&
    !/^[a-f0-9]{64}$/i.test(document.sha256)
  ) {
    issues.push({
      path: "document.sha256",
      code: "invalid_sha256",
      message: "sha256 must contain exactly 64 hexadecimal characters.",
    });
  }

  if (
    document.pageCount !== undefined &&
    (!Number.isInteger(document.pageCount) ||
      document.pageCount < 1)
  ) {
    issues.push({
      path: "document.pageCount",
      code: "invalid_page_count",
      message: "pageCount must be a positive integer.",
    });
  }

  if (!isoDateTime(document.createdAt)) {
    issues.push({
      path: "document.createdAt",
      code: "invalid_datetime",
      message: "createdAt must be an ISO-compatible date-time.",
    });
  }

  return issues;
}

export function validateCitation(
  citation: Citation,
  record: RegistryRecord,
  registry: RegistryDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!nonEmpty(citation.id)) {
    issues.push({
      path: "citation.id",
      code: "required_string",
      message: "Citation id must be a non-empty string.",
    });
  }

  if (citation.registryId !== registry.id) {
    issues.push({
      path: "citation.registryId",
      code: "registry_mismatch",
      message: `Citation registryId must equal ${registry.id}.`,
    });
  }

  if (citation.recordId !== record.id) {
    issues.push({
      path: "citation.recordId",
      code: "record_mismatch",
      message: `Citation recordId must equal ${record.id}.`,
    });
  }

  if (!citation.sourceId && !citation.documentId) {
    issues.push({
      path: "citation",
      code: "missing_evidence_target",
      message: "A citation must reference a source, a document, or both.",
    });
  }

  if (!validVisibility(citation.visibility)) {
    issues.push({
      path: "citation.visibility",
      code: "invalid_visibility",
      message: `Unsupported visibility: ${String(citation.visibility)}.`,
    });
  }

  if (!isoDateTime(citation.createdAt)) {
    issues.push({
      path: "citation.createdAt",
      code: "invalid_datetime",
      message: "createdAt must be an ISO-compatible date-time.",
    });
  }

  if (citation.fieldId) {
    const recordType = registry.recordTypes.find(
      (candidate) => candidate.id === record.recordTypeId,
    );
    const fieldExists = recordType?.fields.some(
      (field) => field.id === citation.fieldId,
    );

    if (!fieldExists) {
      issues.push({
        path: "citation.fieldId",
        code: "unknown_citation_field",
        message: `Field ${citation.fieldId} does not exist on record type ${record.recordTypeId}.`,
      });
    }
  }

  const locator = citation.locator;

  if (locator) {
    for (const [field, value] of [
      ["page", locator.page],
      ["pageEnd", locator.pageEnd],
      ["lineStart", locator.lineStart],
      ["lineEnd", locator.lineEnd],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1)
      ) {
        issues.push({
          path: `citation.locator.${field}`,
          code: "invalid_locator_number",
          message: `${field} must be a positive integer.`,
        });
      }
    }

    if (
      locator.page !== undefined &&
      locator.pageEnd !== undefined &&
      locator.pageEnd < locator.page
    ) {
      issues.push({
        path: "citation.locator.pageEnd",
        code: "invalid_locator_range",
        message: "pageEnd cannot be less than page.",
      });
    }

    if (
      locator.lineStart !== undefined &&
      locator.lineEnd !== undefined &&
      locator.lineEnd < locator.lineStart
    ) {
      issues.push({
        path: "citation.locator.lineEnd",
        code: "invalid_locator_range",
        message: "lineEnd cannot be less than lineStart.",
      });
    }
  }

  return issues;
}

export function assertValidSource(
  source: Source,
  registryId: string,
): void {
  const issues = validateSource(source, registryId);

  if (issues.length > 0) {
    throw new DomainValidationError("Source is invalid.", issues);
  }
}

export function assertValidDocument(
  document: Document,
  registryId: string,
): void {
  const issues = validateDocument(document, registryId);

  if (issues.length > 0) {
    throw new DomainValidationError("Document is invalid.", issues);
  }
}

export function assertValidCitation(
  citation: Citation,
  record: RegistryRecord,
  registry: RegistryDefinition,
): void {
  const issues = validateCitation(citation, record, registry);

  if (issues.length > 0) {
    throw new DomainValidationError("Citation is invalid.", issues);
  }
}
