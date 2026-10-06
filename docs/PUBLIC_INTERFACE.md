# Configurable public registry interface

PR 5 introduces the first end-user interface powered by the generic engine.

## Public routes

The reference application exposes:

```text
/
  Installed registry directory

/registries/:registryId
  Registry overview and configured record types

/registries/:registryId/records?type=:recordTypeId
  Public record listing for a configured record type

/registries/:registryId/records/:recordId
  Generic record detail, metadata, external identifiers, tags, and
  configured relationships
```

## Configuration-driven rendering

The web application does not know what a legal interpretation, surveillance
technology, algorithm, federal program, or other downstream concept is.

The compiled registry configuration supplies:

- registry title and description;
- record type names;
- title and summary fields;
- list field order;
- detail field order;
- field labels;
- enum display labels;
- relationship labels and inverse labels.

The public interface consumes those definitions through
`@civic-registry/registry`.

## Public visibility boundary

The reference public interface only returns records whose generic
`visibility` value is `public`.

Restricted, private, and embargoed records are treated as unavailable by the
public record loader.

This is a presentation/access boundary in the reference application. A later
authentication and authorization milestone will add role-aware administrative
access.

## Presentation package

`@civic-registry/registry` converts domain records plus compiled configuration
into stable public view models.

Its default behavior includes:

- configured record titles and summaries;
- configured list/detail field selection;
- enum label resolution;
- boolean formatting;
- generic entity-reference rendering metadata;
- tags and external identifiers.

This keeps React components generic and gives downstream applications a
reusable presentation layer outside the reference web application.

## Running the example

With PostgreSQL running:

```bash
pnpm db:migrate
pnpm db:seed -- \
  examples/generic-registry/registry.yaml \
  examples/generic-registry/seed.json
pnpm dev
```

Then browse `http://localhost:3000`.

The checked-in example demonstrates:

- multiple configured record types;
- enum rendering;
- entity references;
- a typed relationship;
- public list and detail views.

## Deliberately deferred

PR 5 does not add:

- full-text search or faceted filtering — PR 6;
- relationship graph visualization — PR 7;
- source-document and citation UI — PR 8;
- immutable public revision history — PR 9;
- admin editing — PR 15.

The public interface should evolve by consuming those shared engine
capabilities rather than reimplementing them locally.
