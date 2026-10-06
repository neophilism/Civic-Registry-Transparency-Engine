import {
  presentRecordSummary,
} from "@civic-registry/registry";

import {
  getPublicRecord,
  getPublicRegistry,
  listPublicRelationships,
} from "../../../../../../../lib/public-registry";
import {
  relationshipDirectionParam,
  relationshipValues,
  type RelationshipQueryParams,
} from "../../../../../../../lib/relationship-params";

export const dynamic = "force-dynamic";

function toObject(
  searchParams: URLSearchParams,
): RelationshipQueryParams {
  const result: RelationshipQueryParams = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      result[key] = [...existing, value];
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      registryId: string;
      recordId: string;
    }>;
  },
) {
  const { registryId, recordId } = await context.params;
  const [registry, record] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecord(registryId, recordId),
  ]);

  if (!registry || !record) {
    return Response.json(
      {
        error: "record_not_found",
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const url = new URL(request.url);
  const query = toObject(url.searchParams);
  const requestedTypes = relationshipValues(query.type);
  const relationshipTypeIds = requestedTypes.filter(
    (id) =>
      registry.config.relationshipTypesById.has(id),
  );
  const direction = relationshipDirectionParam(
    query.direction,
  );
  const result = await listPublicRelationships(
    registry.config,
    record,
    {
      relationshipTypeIds:
        relationshipTypeIds.length > 0
          ? relationshipTypeIds
          : undefined,
      direction,
      maxNodes: 201,
    },
  );

  return Response.json(
    {
      registry: {
        id: registry.config.definition.id,
        name: registry.config.definition.name,
      },
      record: presentRecordSummary(
        record,
        registry.config,
      ),
      filters: {
        relationshipTypeIds,
        direction: direction ?? null,
      },
      ...result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
