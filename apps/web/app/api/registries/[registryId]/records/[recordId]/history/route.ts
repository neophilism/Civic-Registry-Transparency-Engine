import {
  presentRecordSummary,
} from "@civic-registry/registry";

import {
  getPublicHistory,
  getPublicRecord,
  getPublicRegistry,
} from "../../../../../../../lib/public-registry";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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

  const history = await getPublicHistory(
    registry.config,
    record,
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
      history,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
