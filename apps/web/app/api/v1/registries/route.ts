import {
  handleApiRegistries,
  publicApiOptions,
} from "../../../../lib/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = publicApiOptions;

export async function GET() {
  return handleApiRegistries();
}
