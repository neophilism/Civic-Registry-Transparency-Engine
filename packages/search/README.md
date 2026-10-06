# @civic-registry/search

Provider-neutral search contracts for Civic Registry.

## Capabilities

Search requests can combine:

- full-text queries;
- record type;
- status;
- tags;
- configured field filters;
- date/date-time/numeric ranges;
- relevance, updated, published, or configured field sorting;
- pagination.

Responses include result hits plus facets for record types, statuses, tags, and
configured filterable fields.

## Provider boundary

The package does not contain PostgreSQL SQL. It defines and validates the search
contract. PostgreSQL is the first implementation in `@civic-registry/database`.

A future OpenSearch/Elasticsearch provider can implement the same
`SearchProvider` interface without changing downstream registry applications.

## Searchable fields

Search index text is generated only from fields explicitly configured with
`searchable: true`, plus the record ID and tags. Enum values include both the
stored value and configured human label.

This preserves the distinction between fields that happen to exist and fields a
registry intentionally exposes to full-text discovery.
