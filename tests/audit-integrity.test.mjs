import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  computeIntegrityEntryHash,
  integrityFrame,
  sha256Text,
  signIntegrityCheckpoint,
  verifyIntegrityCheckpointSignature,
} from "../packages/database/src/index.ts";

test("integrity framing is byte-length prefixed and chain hashing is deterministic", () => {
  assert.equal(integrityFrame("abc"), "3:abc");
  assert.equal(integrityFrame("é"), "2:é");
  assert.equal(integrityFrame(undefined), "-1:");

  const input = {
    registryId: "registry",
    sequence: 7,
    sourceTable: "audit_event",
    sourceKey: "42",
    payloadHash: sha256Text('{"example":true}'),
    previousHash: "a".repeat(64),
  };

  assert.equal(
    computeIntegrityEntryHash(input),
    computeIntegrityEntryHash(input),
  );
  assert.notEqual(
    computeIntegrityEntryHash(input),
    computeIntegrityEntryHash({
      ...input,
      sequence: 8,
    }),
  );
});

test("Ed25519 checkpoint signatures fail after checkpoint mutation", () => {
  const { privateKey, publicKey } =
    generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({
      format: "pem",
      type: "pkcs8",
    })
    .toString();
  const publicPem = publicKey
    .export({
      format: "pem",
      type: "spki",
    })
    .toString();

  const signed = signIntegrityCheckpoint(
    {
      formatVersion: 1,
      chainAlgorithm: "sha256",
      chainFormat:
        "civic-registry-integrity-v1",
      signatureAlgorithm: "ed25519",
      registryId: "registry",
      sequence: 3,
      headHash: "b".repeat(64),
      entryCount: 3,
      sourceCount: 3,
      recordVersionCount: 1,
      auditEventCount: 2,
      generatedAt:
        "2026-10-06T16:30:00.000Z",
      keyId: "test-key",
    },
    privatePem,
  );

  assert.equal(
    verifyIntegrityCheckpointSignature(
      signed,
      publicPem,
    ),
    true,
  );
  assert.equal(
    verifyIntegrityCheckpointSignature(
      {
        ...signed,
        sequence: 4,
      },
      publicPem,
    ),
    false,
  );
});

test("audit-integrity migration installs SHA-256 chaining, protected storage, and baseline backfill", () => {
  const migration = fs.readFileSync(
    "packages/database/migrations/0010_audit_integrity.sql",
    "utf8",
  );

  assert.match(
    migration,
    /CREATE EXTENSION IF NOT EXISTS pgcrypto/,
  );
  assert.match(
    migration,
    /civic_registry_append_integrity_entry/,
  );
  assert.match(
    migration,
    /civic_registry_integrity_entries_guard/,
  );
  assert.match(
    migration,
    /civic_registry_integrity_sources/,
  );
  assert.match(
    migration,
    /civic_registry_record_version_integrity_trigger/,
  );
  assert.match(
    migration,
    /civic_registry_audit_event_integrity_trigger/,
  );
  assert.match(
    migration,
    /integrity\.history_initialized/,
  );
});
