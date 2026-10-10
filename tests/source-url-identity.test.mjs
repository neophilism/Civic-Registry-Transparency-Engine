import assert from "node:assert/strict";
import test from "node:test";
import { runSourceAdapter } from "../packages/source-adapters/src/index.ts";

test("canonical URL identity preserves path and query case but folds the host", async () => {
  const urls = [
    "https://EXAMPLE.GOV/records/Case?doc=ABC",
    "https://example.gov/records/case?doc=ABC",
    "https://example.gov/records/Case?doc=abc",
    "https://example.gov/records/Case?doc=ABC",
  ];
  const adapter = {
    id: "url-identity",
    label: "URL identity regression",
    allowedHosts: ["example.gov"],
    defaultStartUrls: [],
    async collect() {
      return {
        rows: urls.map((canonical_url, index) => ({
          id: String(index),
          external_id: String(index),
          title: "Example record",
          canonical_url,
          source_adapter: "url-identity",
          retrieved_at: "2026-10-10T10:00:00Z",
        })),
        sourcePages: [],
        warnings: [],
      };
    },
  };
  const result = await runSourceAdapter(adapter);
  assert.deepEqual(result.rows.map((row) => row.id), ["0", "1", "2"]);
  assert.equal(result.manifest.rowCount, 3);
});
