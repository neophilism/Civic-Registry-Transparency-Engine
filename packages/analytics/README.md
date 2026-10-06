# @civic-registry/analytics

Provider-neutral analytics contracts for the Civic Registry & Transparency
Engine.

The package defines reusable snapshots for:

- record counts and record-type distribution;
- lifecycle/status distribution;
- publication trends;
- record-change activity;
- approaching and overdue deadlines;
- record/source evidence coverage;
- configured field dimensions such as records by publisher, agency, category,
  jurisdiction, or other registry-defined attributes.

Persistence-specific aggregation lives in `@civic-registry/database`.

Analytics support two scopes:

- `public`: constrained by public record visibility, public lifecycle states,
  disclosure controls, public deadlines, public evidence, and dimensions
  explicitly marked public in registry configuration;
- `administrative`: the complete internal operational picture.

No bill-specific or domain-specific dimension is built into the package.
