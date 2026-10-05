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
pnpm dev
```

The web application runs at `http://localhost:3000`.

The foundation health endpoint is:

```text
GET /api/health
```

## Quality gates

Run the same checks used by CI:

```bash
pnpm ci
```

Or individually:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Pull-request discipline

Each PR should represent one architectural milestone and leave the default
branch deployable. Generic capabilities belong upstream. Bill-specific logic
belongs in downstream applications unless it exposes a reusable abstraction
needed by multiple products.

## Database note

PR 1 starts PostgreSQL for local development but intentionally creates no
application tables. Persistence, migrations, and migration validation arrive
with the database milestone instead of placeholder migrations.
