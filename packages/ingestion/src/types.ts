import type {
  JsonFieldValue,
  RegistryRecord,
} from "@civic-registry/core";

export const INGESTION_FORMATS = [
  "json",
  "ndjson",
  "csv",
] as const;

export type IngestionFormat =
  (typeof INGESTION_FORMATS)[number];

export const INGESTION_MODES = [
  "create",
  "upsert",
] as const;

export type IngestionMode =
  (typeof INGESTION_MODES)[number];

export interface PathValueSpec {
  path: string;
  required?: boolean;
  trim?: boolean;
  split?: string;
}

export interface LiteralValueSpec {
  literal: JsonFieldValue;
}

export type IngestionValueSpec =
  | PathValueSpec
  | LiteralValueSpec;

export interface IngestionExternalIdentifierSpec {
  scheme: string;
  value: IngestionValueSpec;
  url?: IngestionValueSpec;
}

export interface RecordIngestionProfile {
  id: string;
  recordTypeId: string;
  mode?: IngestionMode;
  recordId: IngestionValueSpec;
  sourceKey?: IngestionValueSpec;
  fields: Record<string, IngestionValueSpec>;
  status?: IngestionValueSpec;
  visibility?: IngestionValueSpec;
  tags?: IngestionValueSpec;
  staticTags?: string[];
  externalIdentifiers?: IngestionExternalIdentifierSpec[];
  createdAt?: IngestionValueSpec;
  updatedAt?: IngestionValueSpec;
  publishedAt?: IngestionValueSpec;
  allowLifecycleBootstrap?: boolean;
  replaceFields?: boolean;
}

export interface CompiledRecordIngestionProfile
  extends RecordIngestionProfile {
  mode: IngestionMode;
  staticTags: string[];
  allowLifecycleBootstrap: boolean;
  replaceFields: boolean;
}

export interface IngestionIssue {
  code: string;
  message: string;
  path?: string;
  index?: number;
  line?: number;
}

export interface DecodedIngestionRow {
  index: number;
  line?: number;
  value: Record<string, unknown>;
  fingerprint: string;
}

export interface DecodeIngestionResult {
  rows: DecodedIngestionRow[];
  issues: IngestionIssue[];
}

export interface MappedIngestionItem {
  index: number;
  line?: number;
  sourceKey: string;
  inputFingerprint: string;
  record: RegistryRecord;
}

export type MapIngestionResult =
  | {
      ok: true;
      item: MappedIngestionItem;
    }
  | {
      ok: false;
      issues: IngestionIssue[];
    };

export interface MapIngestionContext {
  now: string;
}
