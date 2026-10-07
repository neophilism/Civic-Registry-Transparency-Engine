# Source refresh orchestration

The engine provides generic scheduling, leasing, health, run history, and
operator controls for downstream source adapters.

## Separation of concerns

The engine stores and executes refresh orchestration state. It does not know
which agencies, websites, datasets, or policy domains a downstream application
uses.

A downstream application supplies refresh-job definitions that identify:

- registry id;
- adapter id;
- ingestion profile id;
- cadence;
- stale threshold;
- failure backoff;
- empty-result behavior;
- row-count-drop warning threshold; and
- adapter options.

## Worker model

Workers claim due jobs through PostgreSQL leases using
`FOR UPDATE SKIP LOCKED`. This allows multiple workers to poll safely without
executing the same refresh concurrently.

Each run records:

- start/completion state;
- row and warning counts;
- output SHA-256;
- linked ingestion run;
- row-count delta;
- errors; and
- source-adapter manifest metadata.

Failures use bounded backoff. Operators can enable, disable, or queue jobs from
the restricted administrator console.

## Health

Generic health states include:

- disabled;
- never run;
- running;
- healthy;
- warning;
- failing; and
- stale.

A source-specific application decides what constitutes an acceptable cadence
and how zero-row results should be interpreted.

## Security boundary

The web administrator interface never executes remote source fetches directly.
It only changes orchestration state. Source retrieval belongs in a worker
process with the hardened source-client boundary.

## Tests

Engine tests use a synthetic adapter and the generic registry example to verify:

- leasing and competing-worker exclusion;
- successful ingestion linkage;
- row-count-drop warnings;
- failure/backoff behavior;
- health calculation; and
- administrator summaries.

Provider-specific jobs and live-source behavior belong in downstream
repositories.
