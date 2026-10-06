# Scheduled source refresh and health monitoring

PR 21 turns the public-source adapters introduced in PR 20 into an operationally safe recurring pipeline.

The governing flow is:

```text
recurring worker invocation
  -> synchronize refresh definitions
  -> claim due jobs with PostgreSQL leases
  -> run source adapter
  -> ingest deterministic NDJSON
  -> persist adapter + ingestion outcome
  -> schedule next run or retry
  -> expose health in administrator console
```

The scheduler is **database-backed**. An external cron/worker process may poll frequently without causing the source adapters themselves to run at that polling frequency.

## Why polling and cadence are separate

A production worker can invoke:

```bash
pnpm source:refresh-open-legal-interpretations
```

every five or ten minutes.

Each refresh job stores its own `next_run_at` and interval. The worker only claims jobs that are due.

The Open Legal Interpretations reference application currently configures both official-source jobs for a 24-hour cadence.

This keeps source-site traffic conservative while allowing a worker process to recover quickly after restarts or failures.

## Database model

Migration `0011_source_refresh_orchestration.sql` adds:

- `civic_registry_source_refresh_jobs`
- `civic_registry_source_refresh_runs`

A job stores:

- registry id;
- adapter id;
- ingestion profile id;
- enabled state;
- interval;
- stale threshold;
- retry-backoff configuration;
- adapter options;
- empty-result policy;
- row-count drop warning threshold;
- next run time;
- active worker lease;
- most recent result;
- row/warning counts;
- last output SHA-256;
- linked ingestion run id; and
- consecutive failure state.

A run stores:

- job and adapter identity;
- lease token;
- start/completion times;
- status;
- current/previous row counts and delta;
- warning count and warning details;
- output SHA-256;
- source pages visited;
- linked ingestion run id/status;
- ingestion failure count; and
- error/metadata details.

## Lease safety

Workers claim due jobs in a transaction using:

```sql
FOR UPDATE SKIP LOCKED
```

Each claimed job receives a unique lease token and expiration time.

This provides two important guarantees:

1. multiple workers may poll concurrently without claiming the same due job; and
2. a stale worker cannot overwrite the result of a newer claim because completion requires the original lease token.

If a worker dies, the expired lease can be reclaimed. A previously running refresh left behind by the expired lease is marked failed before the replacement run starts.

Administrator controls cannot disable a job while an active worker lease is still valid.

## Retry backoff

Failed refreshes use exponential backoff:

```text
delay = min(maxBackoff, baseBackoff * 2^(consecutiveFailures - 1))
```

The Open Legal Interpretations jobs currently use:

- base backoff: 15 minutes;
- maximum backoff: 6 hours.

A successful or warning-only refresh resets the consecutive failure count.

## Health states

The reusable refresh service reports:

- **disabled** — operator disabled the job;
- **never_run** — synchronized but no run has completed yet;
- **running** — an unexpired worker lease is active;
- **healthy** — most recent run completed successfully and is fresh;
- **warning** — most recent run completed with warnings;
- **failing** — most recent run failed;
- **stale** — the last completed run is older than the configured stale threshold.

The Open Legal Interpretations jobs use a stale threshold of 72 hours.

## Empty-result protection

A source that suddenly returns zero rows often indicates a site-layout change rather than a legitimate empty corpus.

Each job declares one of:

- `allow`
- `warning`
- `failure`

The DOJ OLC job treats zero rows as a **failure**.

The OGE job treats zero rows as a **warning**, because OGE's collection may expose results through client-side rendering and a zero-result server response does not necessarily prove the source corpus is empty.

## Row-count regression monitoring

Each job may define a percentage drop threshold.

If the previous run returned 100 rows and the next run returns 40 with a 50% threshold, the refresh is recorded as completed with warnings.

The run persists:

- previous row count;
- current row count; and
- numeric delta.

This does not assume that every row-count decrease is invalid. It surfaces large changes for operator review.

## Ingestion coupling

A source refresh is not considered only a fetch operation.

The Open Legal Interpretations worker executes:

1. source adapter;
2. deterministic NDJSON output;
3. existing generic ingestion profile;
4. ordinary ingestion service.

The refresh run records the resulting ingestion run id/status/failure count.

Therefore source-refresh health can distinguish:

- adapter/fetch failures;
- parser warnings;
- suspicious row-count changes; and
- partial ingestion failures.

The existing ingestion service still owns schema validation, idempotent upsert behavior, lifecycle protection, immutable history, search maintenance, deadlines, and PR 18 cryptographic integrity capture.

## Worker commands

Synchronize definitions only:

```bash
pnpm source:refresh-sync-open-legal-interpretations
```

Show health and recent run history:

```bash
pnpm source:refresh-status-open-legal-interpretations
```

Run due jobs:

```bash
pnpm source:refresh-open-legal-interpretations
```

Force all enabled jobs due immediately and execute them:

```bash
pnpm source:refresh-open-legal-interpretations -- --force
```

The worker applies pending database migrations before synchronization/execution.

If any claimed refresh fails, the worker process exits non-zero so the surrounding scheduler can alert.

## Recommended deployment

Run the refresh command from a worker or cron environment, not from the web process.

A typical deployment invokes it every 5–10 minutes.

Because schedules and leases live in PostgreSQL:

- overlapping cron invocations are safe;
- multiple worker replicas are safe;
- restarts do not lose the next scheduled time;
- manual queue requests survive until a worker claims them.

The worker requires:

- the same database connection configuration as the engine;
- outbound HTTPS access to the configured official source hosts; and
- the application code containing the thin source adapters.

## Administrator console

The restricted administrator route is:

`/admin/registries/:registryId/source-refresh`

It displays:

- job count;
- healthy/attention/running counts;
- health state and reason;
- last and next run;
- row/warning/failure counts;
- last output SHA-256;
- linked ingestion run;
- last error;
- recent run status;
- row-count delta;
- warning codes; and
- ingestion status.

Operators may:

- enable/disable jobs; and
- queue a job for the next worker poll.

The web process **does not execute source adapters**.

The main registry administrator dashboard also surfaces total refresh jobs and refresh jobs needing attention.

## Definition synchronization

Source-specific job definitions remain in the thin application:

`examples/open-legal-interpretations/adapters/refresh-jobs.ts`

The worker synchronizes these definitions into PostgreSQL.

Synchronization updates cadence, thresholds, adapter options, and labels.

Operator-disabled jobs remain disabled when code definitions are re-synchronized. A definition explicitly marked disabled will disable its persisted job.

Definitions removed from the thin application are disabled rather than deleted so historical run records remain available.

## Tests

PR 21 adds:

### Unit / architecture tests

They verify:

- deterministic health-state calculation;
- the two reference-app jobs and conservative cadence;
- presence of database lease primitives;
- the administrator queue surface; and
- that the administrator web page does not import or execute source adapters.

### PostgreSQL concurrency / health test

The integration test:

1. installs the Open Legal Interpretations registry;
2. synchronizes a refresh job;
3. starts a first worker and holds its lease;
4. starts a competing worker and proves it claims zero jobs;
5. releases the first worker and ingests ten records;
6. verifies healthy state and persisted ingestion linkage;
7. runs a two-row refresh and verifies the configured 80% row-count-drop warning;
8. simulates an adapter outage and verifies failure/backoff;
9. confirms the admin summary reports the refresh issue;
10. disables the job and verifies the health/admin issue state clears; and
11. verifies all run statuses are retained in history.

CI uses synthetic data only. It does not make live calls to DOJ or OGE.

## Next milestones

PR 21 deliberately leaves content expansion separate from operational scheduling.

Later milestones can add:

- attachment/PDF download and extraction;
- structured legal-authority extraction;
- source-specific parsing diagnostics; and
- additional official legal-interpretation adapters.
