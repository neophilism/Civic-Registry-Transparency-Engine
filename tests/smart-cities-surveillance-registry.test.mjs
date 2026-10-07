import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  fetchComplianceRegistryProjectionByExternalRef,
} from "../apps/web/lib/compliance-projection.ts";

const configSource = fs.readFileSync(
  "examples/smart-cities-surveillance-registry/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(
  configSource,
  {
    sourceName:
      "examples/smart-cities-surveillance-registry/registry.yaml",
  },
);
const compiled =
  compileRegistryConfig(config);

test("Smart Cities Surveillance Registry is a valid thin registry configuration", () => {
  assert.deepEqual(
    validateRegistryConfig(config),
    [],
  );
  assert.equal(
    config.registry.id,
    "smart-cities-surveillance-registry",
  );
  assert.deepEqual(
    [...compiled.recordTypesById.keys()],
    [
      "deployment",
      "technology",
      "agency",
      "vendor",
      "policy",
      "audit",
      "violation",
    ],
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "uses-technology",
    ),
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "governed-by",
    ),
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "audits-deployment",
    ),
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "concerns-deployment",
    ),
  );
  assert.ok(
    compiled.deadlines?.definitionsById.has(
      "deployment_audit_due",
    ),
  );
  assert.ok(
    compiled.deadlines?.definitionsById.has(
      "policy_review_due",
    ),
  );
  assert.ok(
    compiled.deadlines?.definitionsById.has(
      "violation_remediation_due",
    ),
  );
  assert.equal(
    compiled.disclosure.withheldRecordBehavior,
    "placeholder",
  );
  assert.equal(
    compiled.notifications.enabled,
    true,
  );
});

test("Smart Cities seed remains synthetic and avoids operational surveillance secrets", () => {
  const seedSource = fs.readFileSync(
    "examples/smart-cities-surveillance-registry/seed.json",
    "utf8",
  );
  const seed = JSON.parse(seedSource);

  assert.equal(
    seed.records.length,
    12,
  );
  assert.equal(
    seed.documents.length,
    4,
  );
  assert.ok(
    seed.records.every(
      (record) =>
        record.registryId ===
        "smart-cities-surveillance-registry",
    ),
  );
  assert.match(
    seedSource,
    /Synthetic|synthetic/,
  );
  assert.doesNotMatch(
    seedSource,
    /password|api[_ -]?key|secret token|latitude|longitude/i,
  );

  const deployments =
    seed.records.filter(
      (record) =>
        record.recordTypeId ===
        "deployment",
    );

  assert.ok(
    deployments.every(
      (record) =>
        typeof record.fields
          .compliance_external_ref ===
          "string",
    ),
  );
  assert.ok(
    deployments.every(
      (record) =>
        !(
          "compliance_resource_id" in
          record.fields
        ),
    ),
  );
});

test("Smart Cities presentation reuses generic registry services and server-side compliance projection", () => {
  const page = fs.readFileSync(
    "apps/web/app/smart-cities-surveillance-registry/page.tsx",
    "utf8",
  );

  assert.match(page, /getPublicRegistry/);
  assert.match(page, /listPublicRecords/);
  assert.match(page, /getPublicAnalytics/);
  assert.match(
    page,
    /getConfiguredComplianceProjectionByExternalRef/,
  );
  assert.match(
    page,
    /intentionally excludes sensitive\s+operational details/i,
  );
  assert.doesNotMatch(
    page,
    /CIVIC_COMPLIANCE_SERVICE_TOKEN/,
  );
});

test("Compliance projection bridge resolves resources by stable external reference and uses service auth", async () => {
  const calls = [];
  const externalRef =
    "registry:smart-cities-surveillance-registry:deployment-one";

  const fetchImpl = async (
    input,
    init,
  ) => {
    const url =
      input instanceof URL
        ? input
        : new URL(
            typeof input ===
            "string"
              ? input
              : input.url,
          );
    calls.push({
      url: url.toString(),
      authorization:
        init?.headers
          ?.authorization,
    });

    if (
      url.pathname ===
        "/v1/integration/resources" &&
      !url.searchParams.has(
        "cursor",
      )
    ) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              resourceType:
                "surveillance-deployment",
              externalRef:
                "registry:other:deployment",
              status: "active",
            },
          ],
          nextCursor:
            "next-page",
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json",
          },
        },
      );
    }

    if (
      url.pathname ===
        "/v1/integration/resources" &&
      url.searchParams.get(
        "cursor",
      ) === "next-page"
    ) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              resourceType:
                "surveillance-deployment",
              externalRef,
              status: "active",
            },
          ],
          nextCursor: null,
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json",
          },
        },
      );
    }

    if (
      url.pathname ===
      "/v1/integration/resources/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/registry-projection"
    ) {
      return new Response(
        JSON.stringify({
          organizationId:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          resource: {
            id:
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            resourceType:
              "surveillance-deployment",
            name:
              "Deployment One",
            externalRef,
            status: "active",
          },
          latestCheck: {
            id:
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "compliant",
            evaluatedAt:
              "2026-10-07T12:00:00.000Z",
            ruleSetId: null,
            ruleSetVersion: null,
            registeredRuleSetId:
              "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            ruleSetHash:
              "abc123",
            registrationMode:
              "registered",
          },
          certifications: {
            validCount: 1,
            activeCertificateNumbers: [
              "CERT-001",
            ],
          },
          findings: {
            unresolvedCount: 2,
            unresolvedHighCriticalCount: 0,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json",
          },
        },
      );
    }

    return new Response(
      "unexpected request",
      { status: 500 },
    );
  };

  const result =
    await fetchComplianceRegistryProjectionByExternalRef(
      externalRef,
      "surveillance-deployment",
      {
        baseUrl:
          "https://compliance.example",
        serviceToken:
          "caiae_test_service_token",
        fetchImpl,
      },
    );

  assert.equal(
    result.resource.externalRef,
    externalRef,
  );
  assert.equal(
    result.latestCheck?.status,
    "compliant",
  );
  assert.equal(
    result.findings.unresolvedCount,
    2,
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (call) =>
        call.authorization ===
        "Bearer caiae_test_service_token",
    ),
  );
});

test("Compliance projection bridge rejects operator tokens and insecure non-local transport", async () => {
  await assert.rejects(
    fetchComplianceRegistryProjectionByExternalRef(
      "registry:test:one",
      "surveillance-deployment",
      {
        baseUrl:
          "https://compliance.example",
        serviceToken:
          "caiau_operator_token",
        fetchImpl: async () =>
          new Response(
            "{}",
            { status: 200 },
          ),
      },
    ),
    /service token/i,
  );

  await assert.rejects(
    fetchComplianceRegistryProjectionByExternalRef(
      "registry:test:one",
      "surveillance-deployment",
      {
        baseUrl:
          "http://compliance.example",
        serviceToken:
          "caiae_service_token",
        fetchImpl: async () =>
          new Response(
            "{}",
            { status: 200 },
          ),
      },
    ),
    /HTTPS/i,
  );
});

test("installed-registry home routes Smart Cities to its dedicated presentation", () => {
  const home = fs.readFileSync(
    "apps/web/app/page.tsx",
    "utf8",
  );

  assert.match(
    home,
    /smart-cities-surveillance-registry/,
  );
  assert.match(
    home,
    /\/smart-cities-surveillance-registry/,
  );
});

test("Compliance Engine import bundle stays outside the registry core and maps deployments by external reference", () => {
  const bundle = JSON.parse(
    fs.readFileSync(
      "examples/smart-cities-surveillance-registry/compliance-resource-import.json",
      "utf8",
    ),
  );

  assert.equal(
    bundle.schemaVersion,
    "1",
  );
  assert.equal(
    bundle.source,
    "smart-cities-surveillance-registry-demo",
  );
  assert.equal(
    bundle.items.length,
    2,
  );
  assert.ok(
    bundle.items.every(
      (item) =>
        item.resourceType ===
          "surveillance-deployment" &&
        item.externalRef.startsWith(
          "registry:smart-cities-surveillance-registry:",
        ) &&
        item.metadata.synthetic ===
          true,
    ),
  );
});
