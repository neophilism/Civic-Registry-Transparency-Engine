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

export interface PublicationStatusConfig {
  id: string;
  label: string;
  description?: string;
  publiclyVisible?: boolean;
  marksPublished?: boolean;
  terminal?: boolean;
}

export interface PublicationApprovalConfig {
  approverRoles: string[];
  minApprovals?: number;
  requesterCannotApprove?: boolean;
}

export interface PublicationTransitionConfig {
  fromStatusId: string;
  toStatusId: string;
  label?: string;
  allowedRoles?: string[];
  approval?: PublicationApprovalConfig;
}

export interface ScheduledPublicationConfig {
  enabled?: boolean;
  fromStatusIds: string[];
  targetStatusId: string;
  allowedRoles?: string[];
}

export interface PublicationLifecycleConfig {
  initialStatusId: string;
  statuses: PublicationStatusConfig[];
  transitions: PublicationTransitionConfig[];
  scheduledPublication?: ScheduledPublicationConfig;
}

export interface RegistryConfigFileV1 {
  schemaVersion: typeof REGISTRY_CONFIG_SCHEMA_VERSION;
  registry: RegistryDefinition;
  publicationLifecycle?: PublicationLifecycleConfig;
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

export interface CompiledPublicationLifecycleConfig {
  definition: PublicationLifecycleConfig;
  statusesById: ReadonlyMap<string, PublicationStatusConfig>;
  transitionsByKey: ReadonlyMap<
    string,
    PublicationTransitionConfig
  >;
  transitionsFromStatus: ReadonlyMap<
    string,
    ReadonlyArray<PublicationTransitionConfig>
  >;
  publicStatusIds: ReadonlySet<string>;
  getStatus(statusId: string): PublicationStatusConfig;
  getTransition(
    fromStatusId: string,
    toStatusId: string,
  ): PublicationTransitionConfig | undefined;
  isPublicStatus(statusId: string): boolean;
}

export interface CompiledRegistryConfig {
  schemaVersion: typeof REGISTRY_CONFIG_SCHEMA_VERSION;
  definition: RegistryDefinition;
  recordTypesById: ReadonlyMap<string, CompiledRecordTypeConfig>;
  relationshipTypesById: ReadonlyMap<string, RelationshipTypeDefinition>;
  publicationLifecycle?: CompiledPublicationLifecycleConfig;
  getRecordType(recordTypeId: string): CompiledRecordTypeConfig;
  getField(recordTypeId: string, fieldId: string): FieldDefinition;
}
