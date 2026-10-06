export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;

export const VISIBILITY_LEVELS = [
  "public",
  "restricted",
  "private",
  "embargoed",
] as const;

export type Visibility = (typeof VISIBILITY_LEVELS)[number];

export const FIELD_TYPES = [
  "text",
  "longText",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "url",
  "email",
  "enum",
  "multiEnum",
  "entityRef",
  "entityRefList",
  "json",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface EnumOption {
  value: string;
  label: string;
  description?: string;
}

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  options?: EnumOption[];
  targetRecordTypeIds?: string[];
}

export interface RecordTypeDefinition {
  id: string;
  name: string;
  pluralName: string;
  description?: string;
  titleFieldId: string;
  summaryFieldId?: string;
  fields: FieldDefinition[];
}

export interface RelationshipTypeDefinition {
  id: string;
  label: string;
  inverseLabel?: string;
  description?: string;
  fromRecordTypeIds?: string[];
  toRecordTypeIds?: string[];
  directed?: boolean;
}

export interface RegistryDefinition {
  id: string;
  name: string;
  description?: string;
  recordTypes: RecordTypeDefinition[];
  relationshipTypes?: RelationshipTypeDefinition[];
  defaultRecordTypeId?: string;
  publicByDefault?: boolean;
}

export type ScalarFieldValue =
  | string
  | number
  | boolean
  | null;

export type JsonFieldValue =
  | ScalarFieldValue
  | JsonFieldValue[]
  | { [key: string]: JsonFieldValue };

export type FieldValue =
  | ScalarFieldValue
  | string[]
  | JsonFieldValue[]
  | { [key: string]: JsonFieldValue };

export interface ExternalIdentifier {
  scheme: string;
  value: string;
  url?: string;
}

export interface RegistryRecord {
  id: EntityId;
  registryId: string;
  recordTypeId: string;
  fields: Record<string, FieldValue>;
  status: string;
  visibility: Visibility;
  externalIdentifiers?: ExternalIdentifier[];
  tags?: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  publishedAt?: ISODateTime;
}

export const ACTOR_KINDS = [
  "person",
  "organization",
  "office",
  "system",
  "other",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Actor {
  id: EntityId;
  kind: ActorKind;
  name: string;
  description?: string;
  externalIdentifiers?: ExternalIdentifier[];
}

export interface Organization extends Actor {
  kind: "organization";
  shortName?: string;
  parentOrganizationId?: EntityId;
  website?: string;
}

export const SOURCE_TYPES = [
  "webpage",
  "document",
  "dataset",
  "api",
  "feed",
  "other",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Source {
  id: EntityId;
  title: string;
  sourceType: SourceType;
  publisherActorId?: EntityId;
  canonicalUrl?: string;
  publishedAt?: ISODateTime;
  retrievedAt?: ISODateTime;
  description?: string;
}

export interface Document {
  id: EntityId;
  title: string;
  sourceId?: EntityId;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  canonicalUrl?: string;
  sha256?: string;
  pageCount?: number;
  language?: string;
}

export interface CitationLocator {
  page?: number;
  section?: string;
  paragraph?: string;
  lineStart?: number;
  lineEnd?: number;
  fragment?: string;
}

export interface Citation {
  id: EntityId;
  recordId: EntityId;
  sourceId?: EntityId;
  documentId?: EntityId;
  locator?: CitationLocator;
  note?: string;
}

export interface Relationship {
  id: EntityId;
  registryId: string;
  relationshipTypeId: string;
  fromRecordId: EntityId;
  toRecordId: EntityId;
  createdAt: ISODateTime;
  metadata?: Record<string, JsonFieldValue>;
}

export interface Tag {
  id: EntityId;
  label: string;
  description?: string;
}

export interface RecordVersion {
  id: EntityId;
  recordId: EntityId;
  version: number;
  createdAt: ISODateTime;
  actorId?: EntityId;
  reason?: string;
  snapshot: RegistryRecord;
}
