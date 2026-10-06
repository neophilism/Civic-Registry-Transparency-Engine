import {
  presentRecordSummary,
} from "@civic-registry/registry";

import {
  getPublicHistory,
  getPublicRecordView,
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

  const history = await getPublicHistory(
    registry.config,
    recordView.record,
  );

  return Response.json(
    {
      registry: {
        id: registry.config.definition.id,
        name: registry.config.definition.name,
      },
      record: presentRecordSummary(
        recordView.record,
        registry.config,
        recordView.disclosure,
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
