# Shared packages

Shared engine packages remain generic and reusable by multiple downstream civic
applications.

Implemented packages now include:

- `core` — domain objects and validation;
- `config` — declarative registry configuration;
- `database` — PostgreSQL persistence and services;
- `registry` — public presentation, evidence, relationships, and history;
- `search` — provider-neutral search contracts;
- `deadlines` — pure deadline calculations and presentation;
- `ingestion` — provider-neutral structured import decoding/mapping;
- `api` — versioned public API contracts, OpenAPI, and exports;
- `sdk` — TypeScript public API client.

Future packages may include dedicated document-processing, audit, UI, or other
shared capabilities when real downstream applications demonstrate the need.

Bill-specific terminology and policy rules belong in downstream applications,
not in these packages unless they can be expressed as generic capabilities.
