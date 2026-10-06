import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  Document,
  DocumentDisclosure,
  DocumentRedaction,
  FieldDisclosure,
  RecordDisclosure,
  RegistryRecord,
} from "@civic-registry/core";

export interface PublicDisclosureBasis {
  reason?: string;
  authority?: string;
  publicNote?: string;
}

export interface PublicFieldDisclosure
  extends PublicDisclosureBasis {
  fieldId: string;
  disposition: FieldDisclosure["disposition"];
  replacementText: string;
}

export interface PublicRecordDisclosure
  extends PublicDisclosureBasis {
  disposition: "disclosed" | "redacted" | "withheld";
  fields: Record<string, PublicFieldDisclosure>;
}

export interface PublicRecordProjection {
  record: RegistryRecord | null;
  disclosure: PublicRecordDisclosure;
}

export interface PublicDocumentRedaction
  extends PublicDisclosureBasis {
  id: string;
  locator?: DocumentRedaction["locator"];
  replacementText?: string;
}

export interface PublicDocumentDisclosure
  extends PublicDisclosureBasis {
  disposition:
    | "disclosed"
    | "redacted"
    | "withheld";
  redactions: PublicDocumentRedaction[];
}

export interface PublicDocumentProjection {
  document: Document;
  disclosure: PublicDocumentDisclosure;
}

function visibleBasis(
  registry: CompiledRegistryConfig,
  basis:
    | RecordDisclosure
    | FieldDisclosure
    | DocumentDisclosure
    | DocumentRedaction
    | undefined,
): PublicDisclosureBasis {
  if (!basis) return {};

  return {
    reason: registry.disclosure.showReasons
      ? basis.reason
      : undefined,
    authority: registry.disclosure.showAuthorities
      ? basis.authority
      : undefined,
    publicNote: basis.publicNote,
  };
}

function replacementText(
  registry: CompiledRegistryConfig,
  disclosure: FieldDisclosure,
): string {
  if (disclosure.replacementText?.trim()) {
    return disclosure.replacementText;
  }

  return disclosure.disposition === "redacted"
    ? registry.disclosure.defaultRedactionText
    : registry.disclosure.defaultWithheldFieldText;
}

export function projectRecordForPublic(
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
  recordDisclosure: RecordDisclosure | null = null,
  fieldDisclosures: FieldDisclosure[] = [],
): PublicRecordProjection {
  const fieldRules = new Map(
    fieldDisclosures.map((item) => [
      item.fieldId,
      item,
    ]),
  );
  const fields: Record<
    string,
    PublicFieldDisclosure
  > = {};

  for (const item of fieldDisclosures) {
    const replacement = replacementText(
      registry,
      item,
    );
    fields[item.fieldId] = {
      fieldId: item.fieldId,
      disposition: item.disposition,
      replacementText: replacement,
      ...visibleBasis(registry, item),
    };
  }

  if (recordDisclosure?.disposition === "withheld") {
    const disclosure: PublicRecordDisclosure = {
      disposition: "withheld",
      fields: {},
      ...visibleBasis(
        registry,
        recordDisclosure,
      ),
    };

    if (
      registry.disclosure.withheldRecordBehavior ===
      "hidden"
    ) {
      return {
        record: null,
        disclosure,
      };
    }

    const recordType = registry.getRecordType(
      record.recordTypeId,
    );
    const safeFields: RegistryRecord["fields"] = {
      [recordType.definition.titleFieldId]:
        registry.disclosure.withheldRecordTitle,
    };

    if (recordType.definition.summaryFieldId) {
      safeFields[
        recordType.definition.summaryFieldId
      ] = registry.disclosure.withheldRecordSummary;
    }

    return {
      record: {
        ...record,
        fields: safeFields,
        tags: [],
        externalIdentifiers: [],
      },
      disclosure,
    };
  }

  const safeFields = {
    ...record.fields,
  };

  for (const [fieldId, rule] of fieldRules) {
    safeFields[fieldId] = replacementText(
      registry,
      rule,
    );
  }

  return {
    record: {
      ...record,
      fields: safeFields,
    },
    disclosure: {
      disposition:
        fieldDisclosures.length > 0
          ? "redacted"
          : "disclosed",
      fields,
      ...visibleBasis(
        registry,
        recordDisclosure ?? undefined,
      ),
    },
  };
}

export function projectDocumentForPublic(
  document: Document,
  registry: CompiledRegistryConfig,
  documentDisclosure:
    | DocumentDisclosure
    | null = null,
  redactions: DocumentRedaction[] = [],
): PublicDocumentProjection {
  const disposition =
    documentDisclosure?.disposition ??
    (redactions.length > 0
      ? "redacted"
      : "disclosed");
  const publicRedactions =
    redactions.map((redaction) => ({
      id: redaction.id,
      locator: redaction.locator,
      replacementText:
        redaction.replacementText,
      ...visibleBasis(registry, redaction),
    }));

  if (disposition === "withheld") {
    return {
      document: {
        id: document.id,
        registryId: document.registryId,
        title:
          registry.disclosure.withheldDocumentTitle,
        visibility: document.visibility,
        createdAt: document.createdAt,
      },
      disclosure: {
        disposition,
        redactions: publicRedactions,
        ...visibleBasis(
          registry,
          documentDisclosure ?? undefined,
        ),
      },
    };
  }

  if (disposition === "redacted") {
    return {
      document: {
        ...document,
        storageKey:
          documentDisclosure?.publicStorageKey,
        canonicalUrl:
          documentDisclosure?.publicCanonicalUrl,
        sha256: undefined,
      },
      disclosure: {
        disposition,
        redactions: publicRedactions,
        ...visibleBasis(
          registry,
          documentDisclosure ?? undefined,
        ),
      },
    };
  }

  return {
    document,
    disclosure: {
      disposition,
      redactions: publicRedactions,
      ...visibleBasis(
        registry,
        documentDisclosure ?? undefined,
      ),
    },
  };
}
