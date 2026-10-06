import {
  publicApiJson,
  publicApiOptions,
} from "../../../lib/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = publicApiOptions;

export async function GET() {
  return publicApiJson({
    name:
      "Civic Registry & Transparency Engine Public API",
    openapi: "/api/v1/openapi.json",
    registries: "/api/v1/registries",
  });
}
