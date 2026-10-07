# Smart Cities Surveillance Registry

PR 24 adds the second major thin reference application for the Civic Registry & Transparency Engine.

It demonstrates a public surveillance-accountability registry built from the existing generic registry, evidence, relationship, deadline, search, API, analytics, notification, disclosure, and integrity primitives.

The application is intentionally **not** an operational surveillance system.

## Purpose

The reference application exposes public accountability information about:

- surveillance technologies;
- public agencies;
- vendors;
- approved deployments;
- purposes and public-safe location scope;
- sensors and data categories;
- approved-use policies;
- retention/deletion rules;
- sharing rules;
- warrant or legal-process requirements;
- audits; and
- reported violations/remediation deadlines.

The included data is synthetic.

## Public-safety boundary

The registry is designed to publish accountability information without becoming a source of sensitive operational intelligence.

The demonstration data deliberately does not contain:

- live device coordinates;
- camera network topology;
- access credentials;
- API keys;
- secret tokens;
- covert investigative techniques;
- live target information; or
- personal surveillance data.

A deployment may describe a public location scope such as a road corridor or district, but the reference dataset avoids precise operational positions.

## Thin-application boundary

Smart Cities contributes:

- `examples/smart-cities-surveillance-registry/registry.yaml`
- `examples/smart-cities-surveillance-registry/seed.json`
- `examples/smart-cities-surveillance-registry/compliance-resource-import.json`
- `apps/web/app/smart-cities-surveillance-registry/page.tsx`
- application-specific documentation and tests.

It does not add Smart Cities-specific concepts to the engine core.

## Record model

### Deployment

Public deployment records include:

- jurisdiction;
- deployment status;
- approved purpose;
- public summary;
- public-safe location scope;
- data categories;
- maximum retention period;
- sharing rules;
- warrant/legal-process requirement;
- approval and deployment dates;
- next public audit date; and
- optional Compliance Engine external reference.

### Technology

Technology records include:

- technology category;
- sensors/inputs;
- data categories;
- manufacturer/model; and
- public description.

### Agency

Agency records describe the public body operating a deployment.

### Vendor

Vendor records identify suppliers without treating the vendor as the public decision-maker.

### Policy

Policy records cover:

- approved use;
- retention/deletion;
- access;
- sharing;
- legal process;
- privacy; and
- other public controls.

### Audit

Audit records capture:

- period;
- audit type;
- completion date;
- overall status;
- public findings summary; and
- next audit date.

### Violation

Violation records capture:

- category;
- report date;
- status;
- public summary;
- remediation due date; and
- resolution date.

## Relationship graph

The application configures:

- `uses-technology`
- `operated-by`
- `supplied-by`
- `governed-by`
- `audits-deployment`
- `concerns-deployment`
- `identified-violation`

The generic relationship graph can therefore answer questions such as:

```text
deployment
  -> technology
      -> vendor
  -> agency
  -> policy
  <- audit
  <- violation
      <- identifying audit
```

No Smart Cities-specific graph implementation exists.

## Public deadlines

The reference application configures three generic deadline definitions.

### Deployment audit due

Anchored to:

`deployment.next_audit_due_on`

with a 30-day warning window.

### Policy review due

Anchored to:

`policy.review_due_on`

with a 30-day warning window.

### Violation remediation due

Anchored to:

`violation.remediation_due_on`

with a 14-day warning window.

These are transparency deadlines in the Registry Engine.

They do not replace actual per-record retention/deletion enforcement in the Compliance Engine.

## Evidence

The synthetic seed includes public PDF metadata and field-level citations for:

- approved-use policy;
- ALPR retention/sharing policy;
- ALPR audit; and
- ALPR violation finding.

The ordinary generic evidence repositories provide source/document/citation traceability.

## Search, API, analytics, disclosure, and integrity

Because Smart Cities is an installed registry, it automatically receives:

- full-text and faceted search;
- generic record pages;
- relationship graph traversal;
- source/document evidence;
- public API;
- JSON/NDJSON/CSV exports;
- analytics;
- disclosure/redaction;
- notifications;
- immutable record history; and
- PR 18 cryptographic audit integrity.

No separate Smart Cities implementation exists for those capabilities.

## Compliance Engine boundary

The agency-facing enforcement component belongs to the separate **Compliance, Authorization & Immutable Audit Engine**.

That engine owns capabilities such as:

- compliance rule evaluation;
- authorization;
- evidence;
- retention/deletion checks;
- findings;
- remediation;
- certification; and
- immutable compliance audit history.

The two engines do **not** share database tables.

Cross-engine integration uses the Compliance Engine's stable HTTP integration API.

## Portable resource mapping

Registry deployments use:

`compliance_external_ref`

rather than an environment-specific Compliance Engine UUID.

Example:

```text
registry:smart-cities-surveillance-registry:deployment-municipal-alpr-pilot
```

PR 24 includes:

`examples/smart-cities-surveillance-registry/compliance-resource-import.json`

This is a Compliance Engine resource-import bundle with two synthetic `surveillance-deployment` resources.

Each bundle item includes:

- stable external id;
- stable external reference;
- resource type;
- public compliance facts such as retention days and audit date; and
- metadata identifying the originating registry record.

The Compliance Engine may assign different internal resource UUIDs in each environment without breaking the registry mapping.

## Registry projection

The Compliance Engine already exposes:

```text
GET /v1/integration/resources/:resourceId/registry-projection
```

PR 24 adds a server-side bridge that first resolves a `surveillance-deployment` resource by its stable external reference through:

```text
GET /v1/integration/resources
```

and then retrieves the compact registry projection.

The projection contains public-safe summary information:

- resource status;
- latest compliance check/status;
- valid certification count;
- unresolved finding count; and
- unresolved high/critical finding count.

The Registry Engine does not reach into the Compliance Engine database.

## Authentication

The projection bridge requires a **service** credential.

Environment variables:

```bash
CIVIC_COMPLIANCE_API_BASE_URL=https://compliance.example
CIVIC_COMPLIANCE_SERVICE_TOKEN=caiae_...
```

The bridge rejects the Compliance Engine's human/operator token family (`caiau_...`).

The token remains server-side.

Non-local Compliance Engine URLs must use HTTPS.

Local development may use `http://localhost` or `http://127.0.0.1`.

## Failure isolation

The public registry does not depend on Compliance Engine availability.

If the integration is not configured:

- normal public registry records still render;
- no compliance request is made.

If the Compliance Engine is configured but unavailable:

- the deployment remains browsable;
- the page reports that the projection is unavailable;
- no registry record is mutated.

This keeps transparency availability independent from the enforcement service.

## Importing the synthetic Compliance resources

The included JSON bundle follows the Compliance Engine's existing integration import contract:

```text
POST /v1/integration/import/resources
Authorization: Bearer caiae_...
Idempotency-Key: <unique-key>
```

The Registry repository intentionally does not duplicate Compliance Engine resource persistence or rule evaluation.

## Local seed

After migrations:

```bash
pnpm db:seed-smart-cities-surveillance-registry
```

Then visit:

```text
http://localhost:3000/smart-cities-surveillance-registry
```

The generic installed-registry route remains available at:

```text
http://localhost:3000/registries/smart-cities-surveillance-registry
```

## Tests

PR 24 adds configuration/unit coverage for:

- valid seven-record-type registry schema;
- relationship/deadline configuration;
- synthetic/public-safe seed constraints;
- dedicated presentation using only generic registry services;
- stable external-reference mapping;
- paginated Compliance Engine resource resolution;
- service-token authentication;
- rejection of operator tokens;
- HTTPS enforcement for non-local integration;
- Compliance Engine import-bundle shape; and
- dedicated homepage routing.

The PostgreSQL end-to-end test verifies:

1. the registry and all 12 synthetic records seed successfully;
2. four public evidence documents and citations persist;
3. full-text search finds retention/deletion accountability records;
4. graph traversal connects the ALPR deployment to technology, agency, policy, audit, and violation;
5. deployment-audit, policy-review, and violation-remediation deadlines are generated;
6. audit evidence resolves to its PDF source;
7. the stable compliance external reference persists; and
8. cryptographic integrity remains valid.

## Next milestone

The next step can deepen the cross-engine demonstration by adding a thin Smart Cities compliance ruleset/deployment workflow in the Compliance Engine repository, including retention/deletion checks and compliance reporting, while preserving the API-only boundary between engines.
