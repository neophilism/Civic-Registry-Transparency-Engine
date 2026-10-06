import {
  presentRecordSummary,
} from "@civic-registry/registry";

import {
  getPublicRecordView,
  getPublicRegistry,
  getPublicRelationshipGraph,
} from "../../../../../../../lib/public-registry";
import {
  relationshipDepthParam,
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
  const [registry, recordView] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecordView(registryId, recordId),
  ]);

  if (!registry || !recordView) {
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
  const depth = relationshipDepthParam(query.depth);
  const requestedTypes = relationshipValues(query.type);
  const relationshipTypeIds = requestedTypes.filter(
    (id) =>
      registry.config.relationshipTypesById.has(id),
  );
  const result = await getPublicRelationshipGraph(
    registry.config,
    recordView.record.id,
    {
      depth,
      relationshipTypeIds:
        relationshipTypeIds.length > 0
          ? relationshipTypeIds
          : undefined,
      maxNodes: 100,
    },
  );

  if (!result) {
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

  return Response.json(
    {
      registry: {
        id: registry.config.definition.id,
        name: registry.config.definition.name,
      },
      root: presentRecordSummary(
        recordView.record,
        registry.config,
        recordView.disclosure,
      ),
      filters: {
        depth,
        relationshipTypeIds,
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
