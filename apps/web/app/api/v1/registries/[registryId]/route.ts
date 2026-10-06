import {
  handleApiRegistry,
  publicApiOptions,
} from "../../../../../lib/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = publicApiOptions;

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      registryId: string;
    }>;
  },
) {
  const { registryId } = await context.params;
  return handleApiRegistry(registryId);
}
