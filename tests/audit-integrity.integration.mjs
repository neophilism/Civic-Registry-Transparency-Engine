import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const configSource = await readFile(
  "examples/generic-registry/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(configSource, {
  sourceName:
    "examples/generic-registry/registry.yaml",
});

test("cryptographic audit chain detects source tampering and signed checkpoints bind backups", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-audit-integrity-tests",
  });
  const temp = await mkdtemp(
    join(tmpdir(), "civic-integrity-"),
  );

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const configs =
      new PostgresRegistryConfigRepository(pool);
    await configs.upsert(config);

    const records = new PostgresRecordRepository(
      pool,
      configs,
    );
    const record = await records.create(
      {
        id: "integrity-record",
        registryId: config.registry.id,
        recordTypeId: "document",
        fields: {
          title: "Integrity test",
          document_type: "report",
        },
        status: "published",
        visibility: "public",
        externalIdentifiers: [],
        tags: ["integrity"],
        createdAt:
          "2026-10-06T16:00:00.000Z",
        updatedAt:
          "2026-10-06T16:00:00.000Z",
        publishedAt:
          "2026-10-06T16:00:00.000Z",
      },
      {
        bootstrapLifecycle: true,
      },
    );

    await records.update({
      ...record,
      fields: {
        ...record.fields,
        title: "Integrity test updated",
      },
      updatedAt:
        "2026-10-06T16:05:00.000Z",
    });

    const integrity =
      new PostgresIntegrityService(pool);
    const verified =
      await integrity.verifyRegistry(
        config.registry.id,
      );

    assert.equal(verified.valid, true);
    assert.equal(
      verified.sourceCount,
      verified.entryCount,
    );
    assert.ok(verified.entryCount >= 4);
    assert.ok(verified.headHash);

    await assert.rejects(
      pool.query(
        `
          UPDATE civic_registry_integrity_entries
          SET entry_hash = $2
          WHERE registry_id = $1
            AND sequence = 1
        `,
        [
          config.registry.id,
          "f".repeat(64),
        ],
      ),
      /integrity storage is managed internally/i,
    );

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
    const backupPath = join(
      temp,
      "registry.dump",
    );

    await writeFile(
      backupPath,
      "immutable backup bytes\n",
      "utf8",
    );

    const checkpoint =
      await integrity.createSignedCheckpoint(
        config.registry.id,
        privatePem,
        {
          backupFilePath: backupPath,
          generatedAt:
            "2026-10-06T16:10:00.000Z",
          keyId: "integration-test-key",
        },
      );

    const checkpointVerification =
      await integrity.verifySignedCheckpoint(
        checkpoint,
        publicPem,
        {
          backupFilePath: backupPath,
        },
      );

    assert.equal(
      checkpointVerification.valid,
      true,
    );
    assert.equal(
      checkpointVerification.signatureValid,
      true,
    );
    assert.equal(
      checkpointVerification.anchorMatches,
      true,
    );
    assert.equal(
      checkpointVerification.backupVerified,
      true,
    );

    await writeFile(
      backupPath,
      "tampered backup bytes\n",
      "utf8",
    );

    const tamperedBackup =
      await integrity.verifySignedCheckpoint(
        checkpoint,
        publicPem,
        {
          backupFilePath: backupPath,
        },
      );

    assert.equal(tamperedBackup.valid, false);
    assert.equal(
      tamperedBackup.backupVerified,
      false,
    );

    await pool.query(
      `
        ALTER TABLE civic_registry_record_versions
        DISABLE TRIGGER
          civic_registry_record_versions_immutable
      `,
    );
    await pool.query(
      `
        UPDATE civic_registry_record_versions
        SET snapshot =
          snapshot ||
          '{"tampered": true}'::jsonb
        WHERE registry_id = $1
          AND record_id = 'integrity-record'
          AND version = 1
      `,
      [config.registry.id],
    );
    await pool.query(
      `
        ALTER TABLE civic_registry_record_versions
        ENABLE TRIGGER
          civic_registry_record_versions_immutable
      `,
    );

    const tampered =
      await integrity.verifyRegistry(
        config.registry.id,
      );

    assert.equal(tampered.valid, false);
    assert.ok(
      tampered.issues.some(
        (issue) =>
          issue.code ===
          "payload_hash_mismatch",
      ),
    );
  } finally {
    await pool.end();
    await rm(temp, {
      recursive: true,
      force: true,
    });
  }
});
