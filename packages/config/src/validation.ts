import {
  validateRegistryDefinition,
  type FieldDefinition,
  type RegistryDefinition,
} from "@civic-registry/core";

import {
  REGISTRY_CONFIG_SCHEMA_VERSION,
  type DeadlineEngineConfig,
  type DisclosureConfig,
  type PublicationLifecycleConfig,
  type RegistryConfigFile,
  type RegistryPresentationConfig,
} from "./types.ts";

export interface ConfigValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class RegistryConfigError extends Error {
  readonly issues: ConfigValidationIssue[];

  constructor(message: string, issues: ConfigValidationIssue[]) {
    super(message);
    this.name = "RegistryConfigError";
    this.issues = issues;
  }
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function safeValidateRegistry(
  candidate: unknown,
): ConfigValidationIssue[] {
  if (!isPlainObject(candidate)) {
    return [
      {
        path: "registry",
        code: "invalid_registry",
        message: "registry must be an object.",
      },
    ];
  }

  if (!Array.isArray(candidate.recordTypes)) {
    return [
      {
        path: "registry.recordTypes",
        code: "invalid_record_types",
        message: "registry.recordTypes must be an array.",
      },
    ];
  }

  for (let index = 0; index < candidate.recordTypes.length; index += 1) {
    const recordType = candidate.recordTypes[index];

    if (!isPlainObject(recordType)) {
      return [
        {
          path: `registry.recordTypes[${index}]`,
          code: "invalid_record_type",
          message: "Each record type must be an object.",
        },
      ];
    }

    if (!Array.isArray(recordType.fields)) {
      return [
        {
          path: `registry.recordTypes[${index}].fields`,
          code: "invalid_fields",
          message: "Each record type must define a fields array.",
        },
      ];
    }
  }

  try {
    return validateRegistryDefinition(
      candidate as unknown as RegistryDefinition,
    );
  } catch (error) {
    return [
      {
        path: "registry",
        code: "invalid_registry_shape",
        message:
          error instanceof Error
            ? error.message
            : "Registry definition has an invalid shape.",
      },
    ];
  }
}

function validateFieldList(
  issues: ConfigValidationIssue[],
  path: string,
  fieldIds: unknown,
  fieldsById: Map<string, FieldDefinition>,
) {
  if (fieldIds === undefined) return;

  if (!Array.isArray(fieldIds) || !fieldIds.every((id) => typeof id === "string")) {
    issues.push({
      path,
      code: "invalid_field_list",
      message: "Must be an array of field identifiers.",
    });
    return;
  }

  const seen = new Set<string>();

  for (const fieldId of fieldIds) {
    if (seen.has(fieldId)) {
      issues.push({
        path,
        code: "duplicate_presentation_field",
        message: `Field ${fieldId} is listed more than once.`,
      });
    }

    seen.add(fieldId);

    if (!fieldsById.has(fieldId)) {
      issues.push({
        path,
        code: "unknown_presentation_field",
        message: `Unknown field: ${fieldId}.`,
      });
    }
  }
}

function validatePresentation(
  presentation: unknown,
  registry: RegistryDefinition,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (presentation === undefined) return issues;

  if (!isPlainObject(presentation)) {
    return [
      {
        path: "presentation",
        code: "invalid_presentation",
        message: "presentation must be an object.",
      },
    ];
  }

  const recordTypePresentation = presentation.recordTypes;

  if (recordTypePresentation === undefined) return issues;

  if (!isPlainObject(recordTypePresentation)) {
    return [
      {
        path: "presentation.recordTypes",
        code: "invalid_record_type_presentation",
        message: "presentation.recordTypes must be an object keyed by record type id.",
      },
    ];
  }

  const recordTypesById = new Map(
    registry.recordTypes.map((recordType) => [recordType.id, recordType]),
  );

  for (const [recordTypeId, config] of Object.entries(recordTypePresentation)) {
    const recordType = recordTypesById.get(recordTypeId);
    const basePath = `presentation.recordTypes.${recordTypeId}`;

    if (!recordType) {
      issues.push({
        path: basePath,
        code: "unknown_presentation_record_type",
        message: `Unknown record type: ${recordTypeId}.`,
      });
      continue;
    }

    if (!isPlainObject(config)) {
      issues.push({
        path: basePath,
        code: "invalid_presentation_record_type",
        message: "Record type presentation must be an object.",
      });
      continue;
    }

    const fieldsById = new Map(
      recordType.fields.map((field) => [field.id, field]),
    );

    validateFieldList(
      issues,
      `${basePath}.listFields`,
      config.listFields,
      fieldsById,
    );
    validateFieldList(
      issues,
      `${basePath}.detailFields`,
      config.detailFields,
      fieldsById,
    );

    if (config.defaultSort !== undefined) {
      if (!isPlainObject(config.defaultSort)) {
        issues.push({
          path: `${basePath}.defaultSort`,
          code: "invalid_default_sort",
          message: "defaultSort must be an object.",
        });
      } else {
        const fieldId = config.defaultSort.fieldId;
        const direction = config.defaultSort.direction;

        if (typeof fieldId !== "string" || !fieldsById.has(fieldId)) {
          issues.push({
            path: `${basePath}.defaultSort.fieldId`,
            code: "unknown_sort_field",
            message: "defaultSort.fieldId must reference a field on this record type.",
          });
        } else if (!fieldsById.get(fieldId)?.sortable) {
          issues.push({
            path: `${basePath}.defaultSort.fieldId`,
            code: "unsortable_default_field",
            message: `Field ${fieldId} must set sortable: true before it can be the default sort field.`,
          });
        }

        if (
          direction !== undefined &&
          direction !== "asc" &&
          direction !== "desc"
        ) {
          issues.push({
            path: `${basePath}.defaultSort.direction`,
            code: "invalid_sort_direction",
            message: "Sort direction must be asc or desc.",
          });
        }
      }
    }
  }

  return issues;
}

const CONFIG_IDENTIFIER_PATTERN =
  /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

function validateRoleList(
  issues: ConfigValidationIssue[],
  path: string,
  value: unknown,
  options: { required?: boolean } = {},
): string[] {
  if (value === undefined && !options.required) return [];

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (role) =>
        typeof role === "string" &&
        role.trim().length > 0,
    )
  ) {
    issues.push({
      path,
      code: "invalid_role_list",
      message:
        "Role lists must be non-empty arrays of non-empty strings.",
    });
    return [];
  }

  const roles = value.map((role) => role.trim());
  const unique = new Set(roles);

  if (unique.size !== roles.length) {
    issues.push({
      path,
      code: "duplicate_role",
      message: "Role lists cannot contain duplicate roles.",
    });
  }

  return roles;
}

function validatePublicationLifecycle(
  lifecycle: unknown,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (lifecycle === undefined) return issues;

  if (!isPlainObject(lifecycle)) {
    return [
      {
        path: "publicationLifecycle",
        code: "invalid_publication_lifecycle",
        message: "publicationLifecycle must be an object.",
      },
    ];
  }

  const statusIds = new Set<string>();
  const statusPublic = new Map<string, boolean>();
  const statusTerminal = new Map<string, boolean>();

  if (
    !Array.isArray(lifecycle.statuses) ||
    lifecycle.statuses.length === 0
  ) {
    issues.push({
      path: "publicationLifecycle.statuses",
      code: "missing_lifecycle_statuses",
      message:
        "publicationLifecycle.statuses must contain at least one status.",
    });
  } else {
    lifecycle.statuses.forEach((candidate, index) => {
      const path = `publicationLifecycle.statuses[${index}]`;

      if (!isPlainObject(candidate)) {
        issues.push({
          path,
          code: "invalid_lifecycle_status",
          message: "Each lifecycle status must be an object.",
        });
        return;
      }

      const id = candidate.id;
      const label = candidate.label;

      if (
        typeof id !== "string" ||
        !CONFIG_IDENTIFIER_PATTERN.test(id)
      ) {
        issues.push({
          path: `${path}.id`,
          code: "invalid_lifecycle_status_id",
          message:
            "Status ids must be lowercase configuration identifiers.",
        });
      } else if (statusIds.has(id)) {
        issues.push({
          path: `${path}.id`,
          code: "duplicate_lifecycle_status",
          message: `Duplicate lifecycle status: ${id}.`,
        });
      } else {
        statusIds.add(id);
      }

      if (
        typeof label !== "string" ||
        label.trim().length === 0
      ) {
        issues.push({
          path: `${path}.label`,
          code: "invalid_lifecycle_status_label",
          message: "Status labels must be non-empty strings.",
        });
      }

      for (const booleanField of [
        "publiclyVisible",
        "marksPublished",
        "terminal",
      ] as const) {
        if (
          candidate[booleanField] !== undefined &&
          typeof candidate[booleanField] !== "boolean"
        ) {
          issues.push({
            path: `${path}.${booleanField}`,
            code: "invalid_lifecycle_boolean",
            message: `${booleanField} must be a boolean when provided.`,
          });
        }
      }

      if (
        candidate.marksPublished === true &&
        candidate.publiclyVisible !== true
      ) {
        issues.push({
          path: `${path}.marksPublished`,
          code: "published_status_not_public",
          message:
            "A status that marks publication must also set publiclyVisible: true.",
        });
      }

      if (typeof id === "string") {
        statusPublic.set(
          id,
          candidate.publiclyVisible === true,
        );
        statusTerminal.set(
          id,
          candidate.terminal === true,
        );
      }
    });
  }

  if (
    typeof lifecycle.initialStatusId !== "string" ||
    !statusIds.has(lifecycle.initialStatusId)
  ) {
    issues.push({
      path: "publicationLifecycle.initialStatusId",
      code: "unknown_initial_status",
      message:
        "initialStatusId must reference a configured lifecycle status.",
    });
  }

  const transitionKeys = new Set<string>();
  const transitions = new Map<
    string,
    {
      approval: boolean;
    }
  >();

  if (!Array.isArray(lifecycle.transitions)) {
    issues.push({
      path: "publicationLifecycle.transitions",
      code: "invalid_lifecycle_transitions",
      message: "publicationLifecycle.transitions must be an array.",
    });
  } else {
    lifecycle.transitions.forEach((candidate, index) => {
      const path =
        `publicationLifecycle.transitions[${index}]`;

      if (!isPlainObject(candidate)) {
        issues.push({
          path,
          code: "invalid_lifecycle_transition",
          message: "Each lifecycle transition must be an object.",
        });
        return;
      }

      const fromStatusId = candidate.fromStatusId;
      const toStatusId = candidate.toStatusId;

      if (
        typeof fromStatusId !== "string" ||
        !statusIds.has(fromStatusId)
      ) {
        issues.push({
          path: `${path}.fromStatusId`,
          code: "unknown_transition_status",
          message:
            "fromStatusId must reference a configured lifecycle status.",
        });
      }

      if (
        typeof toStatusId !== "string" ||
        !statusIds.has(toStatusId)
      ) {
        issues.push({
          path: `${path}.toStatusId`,
          code: "unknown_transition_status",
          message:
            "toStatusId must reference a configured lifecycle status.",
        });
      }

      if (
        typeof fromStatusId === "string" &&
        fromStatusId === toStatusId
      ) {
        issues.push({
          path,
          code: "self_lifecycle_transition",
          message:
            "A lifecycle transition cannot transition a status to itself.",
        });
      }

      if (
        typeof fromStatusId === "string" &&
        statusTerminal.get(fromStatusId) === true
      ) {
        issues.push({
          path: `${path}.fromStatusId`,
          code: "terminal_status_transition",
          message:
            "Terminal lifecycle statuses cannot have outgoing transitions.",
        });
      }

      if (
        typeof candidate.label !== "undefined" &&
        (typeof candidate.label !== "string" ||
          candidate.label.trim().length === 0)
      ) {
        issues.push({
          path: `${path}.label`,
          code: "invalid_transition_label",
          message:
            "Transition labels must be non-empty strings when provided.",
        });
      }

      validateRoleList(
        issues,
        `${path}.allowedRoles`,
        candidate.allowedRoles,
      );

      let hasApproval = false;

      if (candidate.approval !== undefined) {
        hasApproval = true;

        if (!isPlainObject(candidate.approval)) {
          issues.push({
            path: `${path}.approval`,
            code: "invalid_transition_approval",
            message: "approval must be an object.",
          });
        } else {
          const roles = validateRoleList(
            issues,
            `${path}.approval.approverRoles`,
            candidate.approval.approverRoles,
            { required: true },
          );
          const rawMinApprovals =
            candidate.approval.minApprovals;
          const minApprovals =
            rawMinApprovals === undefined
              ? 1
              : rawMinApprovals;

          if (
            typeof minApprovals !== "number" ||
            !Number.isInteger(minApprovals) ||
            minApprovals < 1
          ) {
            issues.push({
              path: `${path}.approval.minApprovals`,
              code: "invalid_min_approvals",
              message:
                "minApprovals must be a positive integer.",
            });
          }

          if (
            candidate.approval.requesterCannotApprove !==
              undefined &&
            typeof candidate.approval
              .requesterCannotApprove !== "boolean"
          ) {
            issues.push({
              path:
                `${path}.approval.requesterCannotApprove`,
              code: "invalid_approval_boolean",
              message:
                "requesterCannotApprove must be a boolean when provided.",
            });
          }
        }
      }

      if (
        typeof fromStatusId === "string" &&
        typeof toStatusId === "string"
      ) {
        const key = `${fromStatusId}->${toStatusId}`;

        if (transitionKeys.has(key)) {
          issues.push({
            path,
            code: "duplicate_lifecycle_transition",
            message:
              `Duplicate lifecycle transition: ${key}.`,
          });
        } else {
          transitionKeys.add(key);
          transitions.set(key, {
            approval: hasApproval,
          });
        }
      }
    });
  }

  const schedule = lifecycle.scheduledPublication;

  if (schedule !== undefined) {
    if (!isPlainObject(schedule)) {
      issues.push({
        path: "publicationLifecycle.scheduledPublication",
        code: "invalid_scheduled_publication",
        message: "scheduledPublication must be an object.",
      });
    } else {
      if (
        schedule.enabled !== undefined &&
        typeof schedule.enabled !== "boolean"
      ) {
        issues.push({
          path:
            "publicationLifecycle.scheduledPublication.enabled",
          code: "invalid_schedule_boolean",
          message: "enabled must be a boolean when provided.",
        });
      }

      const fromStatusIds = schedule.fromStatusIds;

      if (
        !Array.isArray(fromStatusIds) ||
        fromStatusIds.length === 0 ||
        !fromStatusIds.every(
          (statusId) => typeof statusId === "string",
        )
      ) {
        issues.push({
          path:
            "publicationLifecycle.scheduledPublication.fromStatusIds",
          code: "invalid_schedule_sources",
          message:
            "fromStatusIds must be a non-empty array of status ids.",
        });
      } else {
        const unique = new Set(fromStatusIds);

        if (unique.size !== fromStatusIds.length) {
          issues.push({
            path:
              "publicationLifecycle.scheduledPublication.fromStatusIds",
            code: "duplicate_schedule_source",
            message:
              "fromStatusIds cannot contain duplicates.",
          });
        }

        for (const statusId of fromStatusIds) {
          if (!statusIds.has(statusId)) {
            issues.push({
              path:
                "publicationLifecycle.scheduledPublication.fromStatusIds",
              code: "unknown_schedule_status",
              message:
                `Unknown scheduled-publication source status: ${statusId}.`,
            });
          }
        }
      }

      const targetStatusId = schedule.targetStatusId;

      if (
        typeof targetStatusId !== "string" ||
        !statusIds.has(targetStatusId)
      ) {
        issues.push({
          path:
            "publicationLifecycle.scheduledPublication.targetStatusId",
          code: "unknown_schedule_target",
          message:
            "targetStatusId must reference a configured lifecycle status.",
        });
      } else if (
        statusPublic.get(targetStatusId) !== true
      ) {
        issues.push({
          path:
            "publicationLifecycle.scheduledPublication.targetStatusId",
          code: "schedule_target_not_public",
          message:
            "Scheduled publication must target a publicly visible lifecycle status.",
        });
      }

      validateRoleList(
        issues,
        "publicationLifecycle.scheduledPublication.allowedRoles",
        schedule.allowedRoles,
      );

      if (
        Array.isArray(fromStatusIds) &&
        typeof targetStatusId === "string"
      ) {
        for (const fromStatusId of fromStatusIds) {
          const transition =
            transitions.get(
              `${fromStatusId}->${targetStatusId}`,
            );

          if (!transition) {
            issues.push({
              path:
                "publicationLifecycle.scheduledPublication",
              code: "missing_schedule_transition",
              message:
                `Scheduled publication requires a configured transition from ${fromStatusId} to ${targetStatusId}.`,
            });
          } else if (transition.approval) {
            issues.push({
              path:
                "publicationLifecycle.scheduledPublication",
              code: "approval_gated_schedule_transition",
              message:
                `Scheduled publication transition ${fromStatusId}->${targetStatusId} cannot require approval. Complete approval before entering a schedulable status.`,
            });
          }
        }
      }
    }
  }

  return issues;
}

function validateDeadlineOffset(
  issues: ConfigValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      code: "invalid_deadline_offset",
      message: "Deadline offsets must be objects.",
    });
    return;
  }

  if (
    typeof value.value !== "number" ||
    !Number.isInteger(value.value) ||
    value.value < 0
  ) {
    issues.push({
      path: `${path}.value`,
      code: "invalid_deadline_offset_value",
      message:
        "Deadline offset values must be non-negative integers.",
    });
  }

  if (
    value.unit !== "hours" &&
    value.unit !== "calendarDays" &&
    value.unit !== "businessDays" &&
    value.unit !== "weeks"
  ) {
    issues.push({
      path: `${path}.unit`,
      code: "invalid_deadline_offset_unit",
      message:
        "Deadline offset unit must be hours, calendarDays, businessDays, or weeks.",
    });
  }
}

function validateDeadlineStatusList(
  issues: ConfigValidationIssue[],
  path: string,
  value: unknown,
  statusIds: ReadonlySet<string>,
): string[] {
  if (value === undefined) return [];

  if (
    !Array.isArray(value) ||
    !value.every(
      (status) =>
        typeof status === "string" &&
        status.trim().length > 0,
    )
  ) {
    issues.push({
      path,
      code: "invalid_deadline_status_list",
      message:
        "Deadline status lists must contain status ids.",
    });
    return [];
  }

  const values = value.map((status) => status.trim());

  if (new Set(values).size !== values.length) {
    issues.push({
      path,
      code: "duplicate_deadline_status",
      message:
        "Deadline status lists cannot contain duplicates.",
    });
  }

  for (const status of values) {
    if (!statusIds.has(status)) {
      issues.push({
        path,
        code: "unknown_deadline_status",
        message:
          `Unknown deadline lifecycle status: ${status}.`,
      });
    }
  }

  return values;
}

function validateDeadlines(
  deadlines: unknown,
  registry: RegistryDefinition,
  lifecycle: unknown,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (deadlines === undefined) return issues;

  if (!isPlainObject(deadlines)) {
    return [
      {
        path: "deadlines",
        code: "invalid_deadline_config",
        message: "deadlines must be an object.",
      },
    ];
  }

  const recordTypesById = new Map(
    registry.recordTypes.map((recordType) => [
      recordType.id,
      recordType,
    ]),
  );
  const statusIds = new Set<string>();

  if (
    isPlainObject(lifecycle) &&
    Array.isArray(lifecycle.statuses)
  ) {
    for (const status of lifecycle.statuses) {
      if (
        isPlainObject(status) &&
        typeof status.id === "string"
      ) {
        statusIds.add(status.id);
      }
    }
  }

  const calendarIds = new Set(["default"]);

  if (deadlines.calendars !== undefined) {
    if (!Array.isArray(deadlines.calendars)) {
      issues.push({
        path: "deadlines.calendars",
        code: "invalid_deadline_calendars",
        message: "deadlines.calendars must be an array.",
      });
    } else {
      deadlines.calendars.forEach((calendar, index) => {
        const path = `deadlines.calendars[${index}]`;

        if (!isPlainObject(calendar)) {
          issues.push({
            path,
            code: "invalid_deadline_calendar",
            message:
              "Each deadline calendar must be an object.",
          });
          return;
        }

        if (
          typeof calendar.id !== "string" ||
          !CONFIG_IDENTIFIER_PATTERN.test(calendar.id)
        ) {
          issues.push({
            path: `${path}.id`,
            code: "invalid_deadline_calendar_id",
            message:
              "Deadline calendar ids must be lowercase configuration identifiers.",
          });
        } else if (calendarIds.has(calendar.id)) {
          if (calendar.id !== "default") {
            issues.push({
              path: `${path}.id`,
              code: "duplicate_deadline_calendar",
              message:
                `Duplicate deadline calendar: ${calendar.id}.`,
            });
          }
        } else {
          calendarIds.add(calendar.id);
        }

        if (
          calendar.label !== undefined &&
          (
            typeof calendar.label !== "string" ||
            calendar.label.trim().length === 0
          )
        ) {
          issues.push({
            path: `${path}.label`,
            code: "invalid_deadline_calendar_label",
            message:
              "Deadline calendar labels must be non-empty strings.",
          });
        }

        if (calendar.weekendDays !== undefined) {
          if (
            !Array.isArray(calendar.weekendDays) ||
            !calendar.weekendDays.every(
              (day) =>
                typeof day === "number" &&
                Number.isInteger(day) &&
                day >= 0 &&
                day <= 6,
            )
          ) {
            issues.push({
              path: `${path}.weekendDays`,
              code: "invalid_deadline_weekend_days",
              message:
                "weekendDays must contain integers from 0 (Sunday) through 6 (Saturday).",
            });
          } else {
            const unique = new Set(calendar.weekendDays);

            if (unique.size !== calendar.weekendDays.length) {
              issues.push({
                path: `${path}.weekendDays`,
                code: "duplicate_deadline_weekend_day",
                message:
                  "weekendDays cannot contain duplicates.",
              });
            }

            if (unique.size === 7) {
              issues.push({
                path: `${path}.weekendDays`,
                code: "deadline_calendar_has_no_business_days",
                message:
                  "A deadline calendar must leave at least one business day.",
              });
            }
          }
        }

        if (calendar.excludedDates !== undefined) {
          if (
            !Array.isArray(calendar.excludedDates) ||
            !calendar.excludedDates.every(
              (date) =>
                typeof date === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                !Number.isNaN(
                  Date.parse(`${date}T00:00:00.000Z`),
                ),
            )
          ) {
            issues.push({
              path: `${path}.excludedDates`,
              code: "invalid_deadline_excluded_dates",
              message:
                "excludedDates must contain valid YYYY-MM-DD dates.",
            });
          } else if (
            new Set(calendar.excludedDates).size !==
            calendar.excludedDates.length
          ) {
            issues.push({
              path: `${path}.excludedDates`,
              code: "duplicate_deadline_excluded_date",
              message:
                "excludedDates cannot contain duplicates.",
            });
          }
        }
      });
    }
  }

  if (
    !Array.isArray(deadlines.definitions) ||
    deadlines.definitions.length === 0
  ) {
    issues.push({
      path: "deadlines.definitions",
      code: "missing_deadline_definitions",
      message:
        "deadlines.definitions must contain at least one deadline definition.",
    });
    return issues;
  }

  const definitionIds = new Set<string>();

  deadlines.definitions.forEach((definition, index) => {
    const path = `deadlines.definitions[${index}]`;

    if (!isPlainObject(definition)) {
      issues.push({
        path,
        code: "invalid_deadline_definition",
        message:
          "Each deadline definition must be an object.",
      });
      return;
    }

    if (
      typeof definition.id !== "string" ||
      !CONFIG_IDENTIFIER_PATTERN.test(definition.id)
    ) {
      issues.push({
        path: `${path}.id`,
        code: "invalid_deadline_id",
        message:
          "Deadline ids must be lowercase configuration identifiers.",
      });
    } else if (definitionIds.has(definition.id)) {
      issues.push({
        path: `${path}.id`,
        code: "duplicate_deadline_id",
        message:
          `Duplicate deadline definition: ${definition.id}.`,
      });
    } else {
      definitionIds.add(definition.id);
    }

    if (
      typeof definition.label !== "string" ||
      definition.label.trim().length === 0
    ) {
      issues.push({
        path: `${path}.label`,
        code: "invalid_deadline_label",
        message:
          "Deadline labels must be non-empty strings.",
      });
    }

    if (
      definition.description !== undefined &&
      (
        typeof definition.description !== "string" ||
        definition.description.trim().length === 0
      )
    ) {
      issues.push({
        path: `${path}.description`,
        code: "invalid_deadline_description",
        message:
          "Deadline descriptions must be non-empty strings when provided.",
      });
    }

    let recordTypeIds: string[] = [];

    if (definition.recordTypeIds !== undefined) {
      if (
        !Array.isArray(definition.recordTypeIds) ||
        definition.recordTypeIds.length === 0 ||
        !definition.recordTypeIds.every(
          (id) => typeof id === "string",
        )
      ) {
        issues.push({
          path: `${path}.recordTypeIds`,
          code: "invalid_deadline_record_types",
          message:
            "recordTypeIds must be a non-empty array of record type ids.",
        });
      } else {
        recordTypeIds = definition.recordTypeIds;

        if (
          new Set(recordTypeIds).size !==
          recordTypeIds.length
        ) {
          issues.push({
            path: `${path}.recordTypeIds`,
            code: "duplicate_deadline_record_type",
            message:
              "recordTypeIds cannot contain duplicates.",
          });
        }

        for (const id of recordTypeIds) {
          if (!recordTypesById.has(id)) {
            issues.push({
              path: `${path}.recordTypeIds`,
              code: "unknown_deadline_record_type",
              message:
                `Unknown deadline record type: ${id}.`,
            });
          }
        }
      }
    }

    if (!isPlainObject(definition.anchor)) {
      issues.push({
        path: `${path}.anchor`,
        code: "invalid_deadline_anchor",
        message: "Deadline anchor must be an object.",
      });
    } else {
      const kind = definition.anchor.kind;

      if (
        kind !== "createdAt" &&
        kind !== "publishedAt" &&
        kind !== "field" &&
        kind !== "statusEntered" &&
        kind !== "manual"
      ) {
        issues.push({
          path: `${path}.anchor.kind`,
          code: "invalid_deadline_anchor_kind",
          message:
            "Deadline anchor kind must be createdAt, publishedAt, field, statusEntered, or manual.",
        });
      }

      if (kind === "field") {
        const fieldId = definition.anchor.fieldId;

        if (
          typeof fieldId !== "string" ||
          fieldId.trim().length === 0
        ) {
          issues.push({
            path: `${path}.anchor.fieldId`,
            code: "invalid_deadline_anchor_field",
            message:
              "Field-anchored deadlines require fieldId.",
          });
        } else if (recordTypeIds.length === 0) {
          issues.push({
            path: `${path}.recordTypeIds`,
            code: "deadline_field_anchor_requires_record_types",
            message:
              "Field-anchored deadlines must declare recordTypeIds.",
          });
        } else {
          for (const recordTypeId of recordTypeIds) {
            const field = recordTypesById
              .get(recordTypeId)
              ?.fields.find(
                (candidate) =>
                  candidate.id === fieldId,
              );

            if (!field) {
              issues.push({
                path: `${path}.anchor.fieldId`,
                code: "unknown_deadline_anchor_field",
                message:
                  `Field ${fieldId} does not exist on record type ${recordTypeId}.`,
              });
            } else if (
              field.type !== "date" &&
              field.type !== "datetime"
            ) {
              issues.push({
                path: `${path}.anchor.fieldId`,
                code: "invalid_deadline_anchor_field_type",
                message:
                  `Field ${fieldId} must be a date or datetime field.`,
              });
            }
          }
        }
      }

      if (kind === "statusEntered") {
        if (statusIds.size === 0) {
          issues.push({
            path: `${path}.anchor.statusId`,
            code: "deadline_status_anchor_requires_lifecycle",
            message:
              "Status-anchored deadlines require publicationLifecycle configuration.",
          });
        } else if (
          typeof definition.anchor.statusId !==
            "string" ||
          !statusIds.has(
            definition.anchor.statusId,
          )
        ) {
          issues.push({
            path: `${path}.anchor.statusId`,
            code: "unknown_deadline_anchor_status",
            message:
              "statusId must reference a configured lifecycle status.",
          });
        }
      }
    }

    validateDeadlineOffset(
      issues,
      `${path}.offset`,
      definition.offset,
    );

    if (definition.warningOffset !== undefined) {
      validateDeadlineOffset(
        issues,
        `${path}.warningOffset`,
        definition.warningOffset,
      );
    }

    if (
      definition.calendarId !== undefined &&
      (
        typeof definition.calendarId !== "string" ||
        !calendarIds.has(definition.calendarId)
      )
    ) {
      issues.push({
        path: `${path}.calendarId`,
        code: "unknown_deadline_calendar",
        message:
          "calendarId must reference a configured deadline calendar.",
      });
    }

    if (
      definition.dateOnlyAnchorTime !== undefined &&
      definition.dateOnlyAnchorTime !== "start" &&
      definition.dateOnlyAnchorTime !== "end"
    ) {
      issues.push({
        path: `${path}.dateOnlyAnchorTime`,
        code: "invalid_deadline_date_anchor_time",
        message:
          "dateOnlyAnchorTime must be start or end.",
      });
    }

    if (
      definition.publiclyVisible !== undefined &&
      typeof definition.publiclyVisible !== "boolean"
    ) {
      issues.push({
        path: `${path}.publiclyVisible`,
        code: "invalid_deadline_public_visibility",
        message:
          "publiclyVisible must be a boolean when provided.",
      });
    }

    const paused = validateDeadlineStatusList(
      issues,
      `${path}.pauseWhileStatuses`,
      definition.pauseWhileStatuses,
      statusIds,
    );
    const completed = validateDeadlineStatusList(
      issues,
      `${path}.completeWhenStatuses`,
      definition.completeWhenStatuses,
      statusIds,
    );
    const cancelled = validateDeadlineStatusList(
      issues,
      `${path}.cancelWhenStatuses`,
      definition.cancelWhenStatuses,
      statusIds,
    );

    const terminal = new Set([
      ...completed,
      ...cancelled,
    ]);

    for (const status of paused) {
      if (terminal.has(status)) {
        issues.push({
          path,
          code: "conflicting_deadline_status_rule",
          message:
            `Status ${status} cannot both pause and complete/cancel a deadline.`,
        });
      }
    }

    for (const status of completed) {
      if (cancelled.includes(status)) {
        issues.push({
          path,
          code: "conflicting_deadline_status_rule",
          message:
            `Status ${status} cannot both complete and cancel a deadline.`,
        });
      }
    }
  });

  return issues;
}

function validateAnalytics(
  analytics: unknown,
  registry: RegistryDefinition,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (analytics === undefined) return issues;

  if (!isPlainObject(analytics)) {
    return [{
      path: "analytics",
      code: "invalid_analytics",
      message: "analytics must be an object.",
    }];
  }

  for (const key of [
    "publicationTrendDays",
    "changeActivityDays",
    "deadlineHorizonDays",
  ] as const) {
    const value = analytics[key];

    if (
      value !== undefined &&
      (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 3650
      )
    ) {
      issues.push({
        path: `analytics.${key}`,
        code: "invalid_analytics_window",
        message:
          `${key} must be an integer from 1 through 3650.`,
      });
    }
  }

  if (analytics.dimensions === undefined) {
    return issues;
  }

  if (!Array.isArray(analytics.dimensions)) {
    issues.push({
      path: "analytics.dimensions",
      code: "invalid_analytics_dimensions",
      message: "analytics.dimensions must be an array.",
    });
    return issues;
  }

  const recordTypes = new Map(
    registry.recordTypes.map((recordType) => [
      recordType.id,
      recordType,
    ]),
  );
  const seen = new Set<string>();

  analytics.dimensions.forEach((candidate, index) => {
    const path = `analytics.dimensions[${index}]`;

    if (!isPlainObject(candidate)) {
      issues.push({
        path,
        code: "invalid_analytics_dimension",
        message: "Each analytics dimension must be an object.",
      });
      return;
    }

    if (
      typeof candidate.id !== "string" ||
      !CONFIG_IDENTIFIER_PATTERN.test(candidate.id)
    ) {
      issues.push({
        path: `${path}.id`,
        code: "invalid_analytics_dimension_id",
        message:
          "Analytics dimension ids must be lowercase configuration identifiers.",
      });
    } else if (seen.has(candidate.id)) {
      issues.push({
        path: `${path}.id`,
        code: "duplicate_analytics_dimension",
        message:
          `Duplicate analytics dimension: ${candidate.id}.`,
      });
    } else {
      seen.add(candidate.id);
    }

    if (
      typeof candidate.label !== "string" ||
      candidate.label.trim().length === 0
    ) {
      issues.push({
        path: `${path}.label`,
        code: "invalid_analytics_dimension_label",
        message:
          "Analytics dimension labels must be non-empty strings.",
      });
    }

    const recordType =
      typeof candidate.recordTypeId === "string"
        ? recordTypes.get(candidate.recordTypeId)
        : undefined;

    if (!recordType) {
      issues.push({
        path: `${path}.recordTypeId`,
        code: "unknown_analytics_record_type",
        message:
          "recordTypeId must reference a configured record type.",
      });
    }

    const field =
      recordType &&
      typeof candidate.fieldId === "string"
        ? recordType.fields.find(
            (item) => item.id === candidate.fieldId,
          )
        : undefined;

    if (!field) {
      issues.push({
        path: `${path}.fieldId`,
        code: "unknown_analytics_field",
        message:
          "fieldId must reference a field on the configured record type.",
      });
    } else if (
      !["text", "enum", "boolean", "entityRef"].includes(
        field.type,
      )
    ) {
      issues.push({
        path: `${path}.fieldId`,
        code: "unsupported_analytics_field_type",
        message:
          "Analytics dimensions support text, enum, boolean, and entityRef fields.",
      });
    }

    if (
      candidate.publiclyVisible !== undefined &&
      typeof candidate.publiclyVisible !== "boolean"
    ) {
      issues.push({
        path: `${path}.publiclyVisible`,
        code: "invalid_analytics_public_visibility",
        message:
          "publiclyVisible must be a boolean when provided.",
      });
    }

    if (
      candidate.limit !== undefined &&
      (
        typeof candidate.limit !== "number" ||
        !Number.isInteger(candidate.limit) ||
        candidate.limit < 1 ||
        candidate.limit > 50
      )
    ) {
      issues.push({
        path: `${path}.limit`,
        code: "invalid_analytics_dimension_limit",
        message:
          "Analytics dimension limit must be an integer from 1 through 50.",
      });
    }
  });

  return issues;
}

function validateDisclosure(
  disclosure: unknown,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (disclosure === undefined) return issues;

  if (!isPlainObject(disclosure)) {
    return [
      {
        path: "disclosure",
        code: "invalid_disclosure_config",
        message: "disclosure must be an object.",
      },
    ];
  }

  if (
    disclosure.withheldRecordBehavior !== undefined &&
    disclosure.withheldRecordBehavior !== "hidden" &&
    disclosure.withheldRecordBehavior !== "placeholder"
  ) {
    issues.push({
      path: "disclosure.withheldRecordBehavior",
      code: "invalid_withheld_record_behavior",
      message:
        "withheldRecordBehavior must be hidden or placeholder.",
    });
  }

  for (const key of [
    "defaultRedactionText",
    "defaultWithheldFieldText",
    "withheldRecordTitle",
    "withheldRecordSummary",
    "withheldDocumentTitle",
  ] as const) {
    const value = disclosure[key];

    if (
      value !== undefined &&
      (
        typeof value !== "string" ||
        value.trim().length === 0
      )
    ) {
      issues.push({
        path: `disclosure.${key}`,
        code: "invalid_disclosure_text",
        message:
          `${key} must be a non-empty string when provided.`,
      });
    }
  }

  for (const key of [
    "showReasons",
    "showAuthorities",
  ] as const) {
    const value = disclosure[key];

    if (
      value !== undefined &&
      typeof value !== "boolean"
    ) {
      issues.push({
        path: `disclosure.${key}`,
        code: "invalid_disclosure_boolean",
        message:
          `${key} must be a boolean when provided.`,
      });
    }
  }

  return issues;
}

export function validateRegistryConfig(
  value: unknown,
): ConfigValidationIssue[] {
  if (!isPlainObject(value)) {
    return [
      {
        path: "$",
        code: "invalid_config",
        message: "Configuration must be an object.",
      },
    ];
  }

  const issues: ConfigValidationIssue[] = [];

  if (value.schemaVersion !== REGISTRY_CONFIG_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      code: "unsupported_schema_version",
      message: `schemaVersion must be ${REGISTRY_CONFIG_SCHEMA_VERSION}.`,
    });
  }

  const registryIssues = safeValidateRegistry(value.registry);
  issues.push(...registryIssues);

  if (registryIssues.length === 0) {
    issues.push(
      ...validatePublicationLifecycle(
        value.publicationLifecycle,
      ),
    );
    issues.push(
      ...validateDeadlines(
        value.deadlines,
        value.registry as RegistryDefinition,
        value.publicationLifecycle,
      ),
    );
    issues.push(
      ...validateDisclosure(
        value.disclosure,
      ),
    );
    issues.push(
      ...validatePresentation(
        value.presentation,
        value.registry as RegistryDefinition,
      ),
    );
    issues.push(
      ...validateAnalytics(
        value.analytics,
        value.registry as RegistryDefinition,
      ),
    );
  }

  return issues;
}

export function assertValidRegistryConfig(
  value: unknown,
): asserts value is RegistryConfigFile {
  const issues = validateRegistryConfig(value);

  if (issues.length > 0) {
    throw new RegistryConfigError(
      "Registry configuration is invalid.",
      issues,
    );
  }
}

export function getPresentationConfig(
  value: RegistryConfigFile,
): RegistryPresentationConfig {
  return value.presentation ?? {};
}


export function getPublicationLifecycleConfig(
  value: RegistryConfigFile,
): PublicationLifecycleConfig | undefined {
  return value.publicationLifecycle;
}


export function getDisclosureConfig(
  value: RegistryConfigFile,
): DisclosureConfig | undefined {
  return value.disclosure;
}


export function getDeadlineConfig(
  value: RegistryConfigFile,
): DeadlineEngineConfig | undefined {
  return value.deadlines;
}
