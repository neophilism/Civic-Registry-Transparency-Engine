import type {
  FieldType,
  RegistryRecord,
} from "@civic-registry/core";
import type {
  PresentedDeadline,
} from "@civic-registry/deadlines";
import type {
  PresentedCitation,
  PresentedCitationGroup,
  PresentedHistoryEvent,
  PresentedRecordRevision,
  PresentedRelationship,
  PresentedRelationshipGraph,
  PresentedRelationshipGroup,
  PublicRecordDisclosure,
} from "@civic-registry/registry";
import type {
  SearchFacets,
} from "@civic-registry/search";

export const PUBLIC_API_VERSION = "1" as const;

export type PublicApiVersion =
  typeof PUBLIC_API_VERSION;

export interface ApiEnvelope<T> {
  apiVersion: PublicApiVersion;
  data: T;
}

export interface ApiErrorDetail {
  path?: string;
  code?: string;
  message: string;
  [key: string]: unknown;
}

export interface ApiError {
  code: string;
  message: string;
  issues?: ApiErrorDetail[];
}

export interface ApiErrorEnvelope {
  apiVersion: PublicApiVersion;
  error: ApiError;
}

export interface ApiRegistrySummary {
  id: string;
  name: string;
  description?: string;
  defaultRecordTypeId?: string;
}

export interface ApiFieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  description?: string;
  required: boolean;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  targetRecordTypeIds?: string[];
}

export interface ApiRecordTypeDefinition {
  id: string;
  name: string;
  pluralName: string;
  description?: string;
  titleFieldId: string;
  summaryFieldId?: string;
  fields: ApiFieldDefinition[];
  listFieldIds: string[];
  detailFieldIds: string[];
  defaultSort?: {
    fieldId?: string;
    by?: string;
    direction?: "asc" | "desc";
  };
}

export interface ApiRelationshipTypeDefinition {
  id: string;
  label: string;
  inverseLabel?: string;
  description?: string;
  fromRecordTypeIds?: string[];
  toRecordTypeIds?: string[];
  directed: boolean;
}

export interface ApiLifecycleStatus {
  id: string;
  label: string;
  terminal: boolean;
}

export interface ApiDeadlineDefinition {
  id: string;
  label: string;
  description?: string;
}

export interface ApiRegistryDetail
  extends ApiRegistrySummary {
  recordTypes: ApiRecordTypeDefinition[];
  relationshipTypes: ApiRelationshipTypeDefinition[];
  publicLifecycleStatuses: ApiLifecycleStatus[];
  publicDeadlineTypes: ApiDeadlineDefinition[];
}

export interface ApiRecordView {
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
}

export interface ApiSearchHit {
  record: RegistryRecord;
  score: number | null;
}

export interface ApiSearchResult {
  hits: ApiSearchHit[];
  total: number;
  page: number;
  pageSize: number;
  facets: SearchFacets;
}

export interface ApiSearchData {
  registry: ApiRegistrySummary;
  result: ApiSearchResult;
}

export interface ApiRecordData {
  registry: ApiRegistrySummary;
  result: ApiRecordView;
}

export interface ApiEvidenceData {
  registry: ApiRegistrySummary;
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
  evidence: {
    citations: PresentedCitation[];
    groups: PresentedCitationGroup[];
  };
}

export interface ApiHistoryData {
  registry: ApiRegistrySummary;
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
  history: {
    events: PresentedHistoryEvent[];
    revisions: PresentedRecordRevision[];
  };
}

export interface ApiRelationshipsData {
  registry: ApiRegistrySummary;
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
  filters: {
    relationshipTypeIds: string[];
    direction:
      | "outbound"
      | "inbound"
      | "undirected"
      | null;
  };
  relationships: PresentedRelationship[];
  groups: PresentedRelationshipGroup[];
  truncated: boolean;
}

export interface ApiGraphData {
  registry: ApiRegistrySummary;
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
  filters: {
    depth: number;
    relationshipTypeIds: string[];
  };
  graph: PresentedRelationshipGraph;
  truncated: boolean;
}

export interface ApiDeadlinesData {
  registry: ApiRegistrySummary;
  record: RegistryRecord;
  disclosure: PublicRecordDisclosure;
  deadlines: PresentedDeadline[];
}

export type ApiExportFormat =
  | "json"
  | "ndjson"
  | "csv";

export interface ApiExportMetadata {
  registry: ApiRegistrySummary;
  generatedAt: string;
  total: number;
  exported: number;
  truncated: boolean;
}

export interface ApiJsonExport
  extends ApiExportMetadata {
  apiVersion: PublicApiVersion;
  records: RegistryRecord[];
}

export interface SerializedApiExport {
  body: string;
  contentType: string;
  extension: string;
  metadata: ApiExportMetadata;
}

export type ApiQueryScalar =
  | string
  | number
  | boolean;

export type ApiQueryValue =
  | ApiQueryScalar
  | ApiQueryScalar[]
  | null
  | undefined;

export type ApiQuery = Record<
  string,
  ApiQueryValue
>;
