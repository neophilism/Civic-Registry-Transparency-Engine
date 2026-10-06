import {
  buildPublicApiOpenApiDocument,
} from "@civic-registry/api";

import {
  publicApiOptions,
  publicApiRawJson,
} from "../../../../lib/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = publicApiOptions;

export async function GET() {
  return publicApiRawJson(
    buildPublicApiOpenApiDocument(),
  );
}
