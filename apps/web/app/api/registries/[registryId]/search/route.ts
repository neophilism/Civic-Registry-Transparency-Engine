import { SearchValidationError } from "@civic-registry/search";

import {
  getPublicRegistry,
  searchPublicRecords,
} from "../../../../../lib/public-registry";
import {
  parsePublicSearchRequest,
  type PublicSearchParams,
} from "../../../../../lib/search-params";

export const dynamic = "force-dynamic";

function toObject(
  searchParams: URLSearchParams,
): PublicSearchParams {
  const result: PublicSearchParams = {};

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
    }>;
  },
) {
  const { registryId } = await context.params;
  const registry = await getPublicRegistry(registryId);

  if (!registry) {
    return Response.json(
      {
        error: "registry_not_found",
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const url = new URL(request.url);
    const query = toObject(url.searchParams);
    const searchRequest = parsePublicSearchRequest(
      registry.config,
      query,
    );
    const result = await searchPublicRecords(
      registry.config,
      searchRequest,
    );

    return Response.json(
      {
        registry: {
          id: registry.config.definition.id,
          name: registry.config.definition.name,
        },
        result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof SearchValidationError) {
      return Response.json(
        {
          error: "invalid_search",
          issues: error.issues,
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    throw error;
  }
}
