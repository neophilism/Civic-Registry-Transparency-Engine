import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";

import type {
  ApiRegistryDetail,
  ApiRegistrySummary,
} from "./types.ts";

export function publicRegistrySummary(
  registry: CompiledRegistryConfig,
): ApiRegistrySummary {
  return {
    id: registry.definition.id,
    name: registry.definition.name,
    description: registry.definition.description,
    defaultRecordTypeId:
      registry.definition.defaultRecordTypeId,
  };
}

export function publicRegistryDetail(
  registry: CompiledRegistryConfig,
): ApiRegistryDetail {
  const summary = publicRegistrySummary(registry);

  return {
    ...summary,
    recordTypes:
      registry.definition.recordTypes.map(
        (definition) => {
          const compiled =
            registry.getRecordType(
              definition.id,
            );

          return {
            id: definition.id,
            name: definition.name,
            pluralName: definition.pluralName,
            description: definition.description,
            titleFieldId:
              definition.titleFieldId,
            summaryFieldId:
              definition.summaryFieldId,
            fields: definition.fields.map(
              (field) => ({
                id: field.id,
                label: field.label,
                type: field.type,
                description:
                  field.description,
                required:
                  field.required === true,
                searchable:
                  field.searchable === true,
                filterable:
                  field.filterable === true,
                sortable:
                  field.sortable === true,
                options: field.options,
                targetRecordTypeIds:
                  field.targetRecordTypeIds,
              }),
            ),
            listFieldIds:
              compiled.listFields.map(
                (field) => field.id,
              ),
            detailFieldIds:
              compiled.detailFields.map(
                (field) => field.id,
              ),
            defaultSort:
              compiled.defaultSort
                ? {
                    fieldId:
                      compiled.defaultSort
                        .fieldId,
                    by:
                      compiled.defaultSort.by,
                    direction:
                      compiled.defaultSort
                        .direction,
                  }
                : undefined,
          };
        },
      ),
    relationshipTypes:
      (registry.definition.relationshipTypes ??
        []).map((relationship) => ({
        id: relationship.id,
        label: relationship.label,
        inverseLabel:
          relationship.inverseLabel,
        description:
          relationship.description,
        fromRecordTypeIds:
          relationship.fromRecordTypeIds,
        toRecordTypeIds:
          relationship.toRecordTypeIds,
        directed:
          relationship.directed === true,
      })),
    publicLifecycleStatuses:
      registry.publicationLifecycle
        ? [
            ...registry.publicationLifecycle
              .publicStatusIds,
          ].map((id) => {
            const status =
              registry.publicationLifecycle!
                .statusesById.get(id)!;

            return {
              id,
              label: status.label,
              terminal:
                status.terminal === true,
            };
          })
        : [],
    publicDeadlineTypes:
      registry.deadlines
        ? [
            ...registry.deadlines
              .definitionsById.values(),
          ]
            .filter(
              (definition) =>
                definition.publiclyVisible ===
                true,
            )
            .map((definition) => ({
              id: definition.id,
              label: definition.label,
              description:
                definition.description,
            }))
        : [],
  };
}
