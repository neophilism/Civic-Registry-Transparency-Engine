# Cryptographic audit integrity

PR 18 adds cryptographic tamper evidence to the immutable revision and audit history introduced in PR 9.

The system now has two distinct integrity layers:

1. **database-enforced immutability** blocks ordinary UPDATE/DELETE operations against historical rows; and
2. **cryptographic integrity** detects historical alteration even if those ordinary protections are bypassed.

These layers are complementary. Hash chaining does not replace access control, database permissions, backups, or the existing immutable-history triggers.

## Integrity ledger

Migration `0010_audit_integrity.sql` creates a registry-wide ordered ledger.

The ledger commits two immutable source types:

- record revisions from `civic_registry_record_versions`; and
- audit events from `civic_registry_audit_events`.

Each source row is converted to a versioned JSONB payload and receives a SHA-256 payload hash.

Each integrity entry contains:

- registry id;
- registry-local sequence number;
- source type;
- source key;
- source payload SHA-256;
- previous integrity-entry hash;
- current integrity-entry hash;
- source occurrence timestamp; and
- capture timestamp.

The entry hash uses a length-prefixed framing format named:

`civic-registry-integrity-v1`

Length-prefixing avoids ambiguous string concatenation.

The first entry has no previous hash. Every later entry commits the immediately preceding entry hash.

## Concurrency

Integrity appends acquire a registry-scoped PostgreSQL transaction advisory lock.

This provides one total ordering per registry even when multiple transactions create audit events or record revisions concurrently.

The current sequence and head hash are stored in `civic_registry_integrity_heads`.

## Storage guards

Direct INSERT/UPDATE/DELETE operations against the integrity ledger and direct mutation of the chain-head table are rejected by database triggers.

The internal append function temporarily enables a transaction-local writer flag while it updates those structures.

These guards prevent accidental or ordinary application mutation. They are not claimed to be a defense against a PostgreSQL superuser who can disable triggers and rewrite functions.

That stronger threat is addressed by external signed checkpoints.

## PR 18 baseline

When migration 0010 is first applied, every existing record revision and audit event is added to the integrity ledger in deterministic order.

This creates a cryptographic commitment to the state that exists at migration time.

It **does not** prove that pre-PR-18 history had never been altered before that baseline was created. No later cryptographic mechanism can retroactively prove facts that were not previously anchored.

After the migration, all new immutable revision and audit rows are chained automatically by INSERT triggers.

An `integrity.history_initialized` audit event records initialization for each installed registry.

## Independent verification

Run:

```bash
pnpm db:integrity-verify
```

to verify every installed registry, or:

```bash
pnpm db:integrity-verify <registry-id>
```

for one registry.

The Node verifier independently checks:

- contiguous sequence numbers;
- every previous-hash link;
- existence of every committed source row;
- current SHA-256 of every source payload;
- every chain-entry hash;
- that every immutable source row has a ledger entry;
- source and ledger counts;
- stored head sequence; and
- stored head hash.

The verifier computes SHA-256 in Node rather than asking PostgreSQL to validate its own stored digest.

A verification failure exits with a non-zero process status.

## Ed25519 signed checkpoints

A database administrator who can disable triggers could theoretically rewrite source rows and then recompute the entire database-resident chain.

To detect that class of attack, create periodic signed checkpoints using an Ed25519 private key held outside PostgreSQL.

Generate a key pair, for example:

```bash
openssl genpkey -algorithm Ed25519 -out integrity-private.pem
openssl pkey -in integrity-private.pem -pubout -out integrity-public.pem
chmod 600 integrity-private.pem
```

Configure the CLI:

```text
CIVIC_REGISTRY_INTEGRITY_PRIVATE_KEY_FILE=/secure/path/integrity-private.pem
CIVIC_REGISTRY_INTEGRITY_PUBLIC_KEY_FILE=/secure/path/integrity-public.pem
```

An optional operational key label may be set with:

```text
CIVIC_REGISTRY_INTEGRITY_KEY_ID=production-audit-key-2026
```

If no key id is supplied, the CLI derives one from the SHA-256 fingerprint of the public key.

Inline PEM environment variables are supported as a fallback, but file-based private-key configuration is preferred.

## Creating a checkpoint

Create a signed checkpoint:

```bash
pnpm db:integrity-checkpoint \
  <registry-id> \
  checkpoint.json
```

The checkpoint signs:

- chain format and algorithms;
- registry id;
- sequence;
- head hash;
- ledger/source counts;
- record-revision count;
- audit-event count;
- generation time; and
- signing-key id.

Checkpoint creation first performs a full live integrity verification. The CLI refuses to sign a chain that is already inconsistent.

## Binding a physical backup

To make a database backup tamper-evident as well as the live audit history, provide the backup file when creating the checkpoint:

```bash
pnpm db:integrity-checkpoint \
  <registry-id> \
  checkpoint.json \
  backup.dump
```

The signed checkpoint then also commits:

- backup filename;
- exact byte length; and
- SHA-256 of the entire backup file.

This does not replace `pg_dump` or another backup system. It cryptographically binds an existing backup artifact to the audit-chain state.

## Verifying a signed checkpoint

With the public key configured:

```bash
pnpm db:integrity-verify \
  <registry-id> \
  checkpoint.json
```

If the checkpoint binds a backup, verify the backup too:

```bash
pnpm db:integrity-verify \
  <registry-id> \
  checkpoint.json \
  backup.dump
```

Verification checks:

- the Ed25519 signature;
- the current live chain;
- that the chain entry at the checkpoint sequence still has the signed head hash; and
- the backup SHA-256 and byte length when a backup file is supplied.

A checkpoint remains useful after the chain grows: verification compares the signed hash against the historical entry at the checkpoint's sequence rather than requiring it to remain the current head.

## Checkpoint storage

Signed checkpoints should be stored outside the database and outside the same administrative trust boundary where practical.

Preferred locations include:

- object storage with retention/Object Lock;
- WORM/immutable archival storage;
- a separately administered evidence repository; or
- another independently controlled system with durable version history.

The private Ed25519 key should not be stored in PostgreSQL and should not be deployed to the public web process.

## Administrator console

The restricted administrator console exposes:

`/admin/registries/:registryId/integrity`

It shows:

- current chain sequence and head;
- source and ledger counts;
- revision/audit-event counts; and
- on-demand live verification with detailed integrity issues.

The web console intentionally cannot create signatures.

## Threat model

PR 18 detects:

- accidental history mutation;
- source-row changes after commitment;
- missing historical rows;
- inserted source rows that were not chained;
- missing/reordered ledger entries;
- broken previous-hash links;
- altered ledger hashes;
- altered chain heads;
- whole-chain rewrites that conflict with an independently stored signed checkpoint; and
- backup-file modification when the backup hash is signed in a checkpoint.

A sufficiently privileged attacker who simultaneously controls the database, the external checkpoint store, and the Ed25519 private key can forge a new coherent history. That is why key custody and checkpoint storage are separate operational controls, not database features.
