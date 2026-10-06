import {
  handleApiRelationships,
  publicApiOptions,
} from "../../../../../../../../lib/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = publicApiOptions;

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      registryId: string;
      recordId: string;
    }>;
  },
) {
  const {
    registryId,
    recordId,
  } = await context.params;

  return handleApiRelationships(
    request,
    registryId,
    recordId,
  );
}
