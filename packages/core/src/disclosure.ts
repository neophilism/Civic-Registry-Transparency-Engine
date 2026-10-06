import type {
  CitationLocator,
  EntityId,
  ISODateTime,
} from "./domain.ts";

export const RECORD_DISCLOSURE_DISPOSITIONS = [
  "disclosed",
  "withheld",
] as const;

export type RecordDisclosureDisposition =
  (typeof RECORD_DISCLOSURE_DISPOSITIONS)[number];

export const FIELD_DISCLOSURE_DISPOSITIONS = [
  "redacted",
  "withheld",
] as const;

export type FieldDisclosureDisposition =
  (typeof FIELD_DISCLOSURE_DISPOSITIONS)[number];

export const DOCUMENT_DISCLOSURE_DISPOSITIONS = [
  "disclosed",
  "redacted",
  "withheld",
] as const;

export type DocumentDisclosureDisposition =
  (typeof DOCUMENT_DISCLOSURE_DISPOSITIONS)[number];

export interface DisclosureBasis {
  reason?: string;
  authority?: string;
  publicNote?: string;
}

export interface RecordDisclosure
  extends DisclosureBasis {
  registryId: string;
  recordId: EntityId;
  disposition: RecordDisclosureDisposition;
  updatedAt: ISODateTime;
  actorId?: EntityId;
}

export interface FieldDisclosure
  extends DisclosureBasis {
  registryId: string;
  recordId: EntityId;
  fieldId: string;
  disposition: FieldDisclosureDisposition;
  replacementText?: string;
  updatedAt: ISODateTime;
  actorId?: EntityId;
}

export interface DocumentDisclosure
  extends DisclosureBasis {
  registryId: string;
  documentId: EntityId;
  disposition: DocumentDisclosureDisposition;
  publicCanonicalUrl?: string;
  publicStorageKey?: string;
  updatedAt: ISODateTime;
  actorId?: EntityId;
}

export interface DocumentRedaction
  extends DisclosureBasis {
  id: EntityId;
  registryId: string;
  documentId: EntityId;
  locator?: CitationLocator;
  replacementText?: string;
  createdAt: ISODateTime;
  actorId?: EntityId;
}
