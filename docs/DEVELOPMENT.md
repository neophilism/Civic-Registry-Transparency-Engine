# Development

## Prerequisites

- Node.js 24
- pnpm 12.7
- Docker with Compose support

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm dev
```

The web application runs at `http://localhost:3000`.

The foundation health endpoint is:

```text
GET /api/health
```

## Database commands

Apply all pending engine migrations:

```bash
pnpm db:migrate
```

Seed the checked-in generic registry example:

```bash
pnpm db:seed -- \
  examples/generic-registry/registry.yaml \
  examples/generic-registry/seed.json
```

Rebuild full-text indexes after changing searchable fields or upgrading an
installation that already contained records before the search migration:

```bash
pnpm db:reindex
```

Run PostgreSQL integration tests:

```bash
pnpm test:db
```

## Quality gates

With the local PostgreSQL service running, execute the same major checks used by
CI:

```bash
pnpm ci
```

Or individually:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm db:reindex
pnpm test:db
pnpm build
```

## Pull-request discipline

Each PR should represent one architectural milestone and leave the default
branch deployable. Generic capabilities belong upstream. Bill-specific logic
belongs in downstream applications unless it exposes a reusable abstraction
needed by multiple products.

## Persistence rule

Downstream registries must not introduce database tables merely because they add
new configured record types or fields. Registry-specific data belongs in the
generic persistence model unless a genuinely shared engine capability requires a
new schema object.

Applied migrations are immutable. Schema changes require a new numbered
migration.
