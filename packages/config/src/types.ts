import type {
  FieldDefinition,
  RecordTypeDefinition,
  RegistryDefinition,
  RelationshipTypeDefinition,
} from "@civic-registry/core";

export const REGISTRY_CONFIG_SCHEMA_VERSION = 1 as const;

export type SortDirection = "asc" | "desc";

export interface DefaultSortConfig {
  fieldId: string;
  direction?: SortDirection;
}

export interface RecordTypePresentationConfig {
  listFields?: string[];
  detailFields?: string[];
  defaultSort?: DefaultSortConfig;
}

export interface RegistryPresentationConfig {
  recordTypes?: Record<string, RecordTypePresentationConfig>;
}

export interface RegistryConfigFileV1 {
  schemaVersion: typeof REGISTRY_CONFIG_SCHEMA_VERSION;
  registry: RegistryDefinition;
  presentation?: RegistryPresentationConfig;
}

export type RegistryConfigFile = RegistryConfigFileV1;

export type FormControlType =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "url"
  | "email"
  | "select"
  | "multiSelect"
  | "entitySelect"
  | "entityMultiSelect"
  | "json";

export interface FormFieldConfig {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  control: FormControlType;
  options?: ReadonlyArray<{ value: string; label: string }>;
  targetRecordTypeIds?: ReadonlyArray<string>;
}

export interface CompiledRecordTypeConfig {
  definition: RecordTypeDefinition;
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  listFields: ReadonlyArray<FieldDefinition>;
  detailFields: ReadonlyArray<FieldDefinition>;
  defaultSort?: Required<DefaultSortConfig>;
  formFields: ReadonlyArray<FormFieldConfig>;
}

export interface CompiledRegistryConfig {
  schemaVersion: typeof REGISTRY_CONFIG_SCHEMA_VERSION;
  definition: RegistryDefinition;
  recordTypesById: ReadonlyMap<string, CompiledRecordTypeConfig>;
  relationshipTypesById: ReadonlyMap<string, RelationshipTypeDefinition>;
  getRecordType(recordTypeId: string): CompiledRecordTypeConfig;
  getField(recordTypeId: string, fieldId: string): FieldDefinition;
}
