import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import type {
  Pool,
  QueryResultRow,
} from "pg";

import {
  PersistenceNotFoundError,
} from "./repositories.ts";

export type IntegritySourceTable =
  | "record_version"
  | "audit_event";

export interface IntegritySummary {
  registryId: string;
  sequence: number;
  headHash?: string;
  entryCount: number;
  sourceCount: number;
  recordVersionCount: number;
  auditEventCount: number;
  updatedAt?: string;
}

export interface IntegrityVerificationIssue {
  code:
    | "sequence_gap"
    | "previous_hash_mismatch"
    | "source_missing"
    | "payload_hash_mismatch"
    | "entry_hash_mismatch"
    | "source_not_chained"
    | "head_sequence_mismatch"
    | "head_hash_mismatch";
  message: string;
  sequence?: number;
  sourceTable?: IntegritySourceTable;
  sourceKey?: string;
}

export interface IntegrityVerificationResult
  extends IntegritySummary {
  valid: boolean;
  verifiedEntries: number;
  issues: IntegrityVerificationIssue[];
}

export interface IntegrityBackupBinding {
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface SignedIntegrityCheckpoint {
  formatVersion: 1;
  chainAlgorithm: "sha256";
  chainFormat: "civic-registry-integrity-v1";
  signatureAlgorithm: "ed25519";
  registryId: string;
  sequence: number;
  headHash?: string;
  entryCount: number;
  sourceCount: number;
  recordVersionCount: number;
  auditEventCount: number;
  generatedAt: string;
  keyId: string;
  backup?: IntegrityBackupBinding;
  signature: string;
}

export interface CheckpointVerificationResult {
  valid: boolean;
  signatureValid: boolean;
  anchorMatches: boolean;
  backupVerified?: boolean;
  currentIntegrityValid: boolean;
  currentSequence: number;
  currentHeadHash?: string;
  issues: string[];
}

interface HeadRow extends QueryResultRow {
  sequence: number | string;
  head_hash: string | null;
  updated_at: Date;
}

interface CountRow extends QueryResultRow {
  source_count: number | string;
  record_version_count: number | string;
  audit_event_count: number | string;
  entry_count: number | string;
}

interface IntegrityEntryRow extends QueryResultRow {
  sequence: number | string;
  source_table: IntegritySourceTable;
  source_key: string;
  payload_hash: string;
  previous_hash: string | null;
  entry_hash: string;
  payload_text: string | null;
}

interface MissingSourceRow extends QueryResultRow {
  source_table: IntegritySourceTable;
  source_key: string;
}

function asNumber(
  value: number | string | null | undefined,
): number {
  return Number(value ?? 0);
}

export function sha256Text(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function integrityFrame(
  value: string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "-1:";
  }

  return (
    Buffer.byteLength(value, "utf8").toString(10) +
    ":" +
    value
  );
}

export function computeIntegrityEntryHash(input: {
  registryId: string;
  sequence: number;
  sourceTable: IntegritySourceTable;
  sourceKey: string;
  payloadHash: string;
  previousHash?: string;
}): string {
  const material = [
    "civic-registry-integrity-v1",
    integrityFrame(input.registryId),
    integrityFrame(input.sequence.toString(10)),
    integrityFrame(input.sourceTable),
    integrityFrame(input.sourceKey),
    integrityFrame(input.payloadHash),
    integrityFrame(input.previousHash),
  ].join("|");

  return sha256Text(material);
}

function normalizePem(value: string): string {
  return value.includes("\\n")
    ? value.replaceAll("\\n", "\n")
    : value;
}

function checkpointSigningPayload(
  checkpoint: Omit<
    SignedIntegrityCheckpoint,
    "signature"
  >,
): string {
  return JSON.stringify({
    formatVersion: checkpoint.formatVersion,
    chainAlgorithm: checkpoint.chainAlgorithm,
    chainFormat: checkpoint.chainFormat,
    signatureAlgorithm:
      checkpoint.signatureAlgorithm,
    registryId: checkpoint.registryId,
    sequence: checkpoint.sequence,
    headHash: checkpoint.headHash ?? null,
    entryCount: checkpoint.entryCount,
    sourceCount: checkpoint.sourceCount,
    recordVersionCount:
      checkpoint.recordVersionCount,
    auditEventCount: checkpoint.auditEventCount,
    generatedAt: checkpoint.generatedAt,
    keyId: checkpoint.keyId,
    backup: checkpoint.backup
      ? {
          fileName: checkpoint.backup.fileName,
          sizeBytes: checkpoint.backup.sizeBytes,
          sha256: checkpoint.backup.sha256,
        }
      : null,
  });
}

function publicKeyId(
  privateKey: KeyObject,
): string {
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({
    format: "der",
    type: "spki",
  });

  return createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 24);
}

async function sha256File(
  path: string,
): Promise<IntegrityBackupBinding> {
  const file = await stat(path);

  if (!file.isFile()) {
    throw new Error(
      `Backup path is not a regular file: ${path}`,
    );
  }

  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return {
    fileName: basename(path),
    sizeBytes: file.size,
    sha256: hash.digest("hex"),
  };
}

export function signIntegrityCheckpoint(
  checkpoint: Omit<
    SignedIntegrityCheckpoint,
    "signature"
  >,
  privateKeyPem: string,
): SignedIntegrityCheckpoint {
  const key = createPrivateKey(
    normalizePem(privateKeyPem),
  );
  const signature = sign(
    null,
    Buffer.from(
      checkpointSigningPayload(checkpoint),
      "utf8",
    ),
    key,
  ).toString("base64");

  return {
    ...checkpoint,
    signature,
  };
}

export function verifyIntegrityCheckpointSignature(
  checkpoint: SignedIntegrityCheckpoint,
  publicKeyPem: string,
): boolean {
  const {
    signature,
    ...unsignedCheckpoint
  } = checkpoint;

  try {
    return verify(
      null,
      Buffer.from(
        checkpointSigningPayload(
          unsignedCheckpoint,
        ),
        "utf8",
      ),
      createPublicKey(
        normalizePem(publicKeyPem),
      ),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export class PostgresIntegrityService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getSummary(
    registryId: string,
  ): Promise<IntegritySummary> {
    const exists = await this.pool.query(
      `
        SELECT 1
        FROM civic_registry_configurations
        WHERE registry_id = $1
      `,
      [registryId],
    );

    if (!exists.rows[0]) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${registryId} does not exist.`,
      );
    }

    const [headResult, countResult] =
      await Promise.all([
        this.pool.query<HeadRow>(
          `
            SELECT
              sequence,
              head_hash,
              updated_at
            FROM civic_registry_integrity_heads
            WHERE registry_id = $1
          `,
          [registryId],
        ),
        this.pool.query<CountRow>(
          `
            SELECT
              (
                SELECT COUNT(*)::bigint
                FROM civic_registry_integrity_sources
                WHERE registry_id = $1
              ) AS source_count,
              (
                SELECT COUNT(*)::bigint
                FROM civic_registry_record_versions
                WHERE registry_id = $1
              ) AS record_version_count,
              (
                SELECT COUNT(*)::bigint
                FROM civic_registry_audit_events
                WHERE registry_id = $1
              ) AS audit_event_count,
              (
                SELECT COUNT(*)::bigint
                FROM civic_registry_integrity_entries
                WHERE registry_id = $1
              ) AS entry_count
          `,
          [registryId],
        ),
      ]);

    const head = headResult.rows[0];
    const counts = countResult.rows[0];

    return {
      registryId,
      sequence: asNumber(head?.sequence),
      headHash: head?.head_hash ?? undefined,
      entryCount: asNumber(
        counts?.entry_count,
      ),
      sourceCount: asNumber(
        counts?.source_count,
      ),
      recordVersionCount: asNumber(
        counts?.record_version_count,
      ),
      auditEventCount: asNumber(
        counts?.audit_event_count,
      ),
      updatedAt:
        head?.updated_at.toISOString(),
    };
  }

  async verifyRegistry(
    registryId: string,
    options: {
      issueLimit?: number;
      batchSize?: number;
    } = {},
  ): Promise<IntegrityVerificationResult> {
    const summary =
      await this.getSummary(registryId);
    const issueLimit = Math.max(
      1,
      Math.min(
        Math.trunc(options.issueLimit ?? 100),
        1000,
      ),
    );
    const batchSize = Math.max(
      100,
      Math.min(
        Math.trunc(options.batchSize ?? 2000),
        10_000,
      ),
    );
    const issues: IntegrityVerificationIssue[] =
      [];

    const addIssue = (
      issue: IntegrityVerificationIssue,
    ) => {
      if (issues.length < issueLimit) {
        issues.push(issue);
      }
    };

    let afterSequence = 0;
    let expectedSequence = 1;
    let previousHash: string | undefined;
    let verifiedEntries = 0;

    while (true) {
      const result =
        await this.pool.query<IntegrityEntryRow>(
          `
            SELECT
              entry.sequence,
              entry.source_table,
              entry.source_key,
              entry.payload_hash,
              entry.previous_hash,
              entry.entry_hash,
              source.payload::text AS payload_text
            FROM civic_registry_integrity_entries
              AS entry
            LEFT JOIN civic_registry_integrity_sources
              AS source
              ON source.registry_id =
                  entry.registry_id
              AND source.source_table =
                  entry.source_table
              AND source.source_key =
                  entry.source_key
            WHERE entry.registry_id = $1
              AND entry.sequence > $2
            ORDER BY entry.sequence ASC
            LIMIT $3
          `,
          [
            registryId,
            afterSequence,
            batchSize,
          ],
        );

      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const sequence = asNumber(row.sequence);

        if (sequence !== expectedSequence) {
          addIssue({
            code: "sequence_gap",
            message:
              `Expected integrity sequence ${expectedSequence} but found ${sequence}.`,
            sequence,
            sourceTable: row.source_table,
            sourceKey: row.source_key,
          });
          expectedSequence = sequence;
        }

        if (
          (row.previous_hash ?? undefined) !==
          previousHash
        ) {
          addIssue({
            code: "previous_hash_mismatch",
            message:
              `Integrity entry ${sequence} does not commit the preceding entry hash.`,
            sequence,
            sourceTable: row.source_table,
            sourceKey: row.source_key,
          });
        }

        if (row.payload_text === null) {
          addIssue({
            code: "source_missing",
            message:
              `Integrity entry ${sequence} references a missing immutable source row.`,
            sequence,
            sourceTable: row.source_table,
            sourceKey: row.source_key,
          });
        } else {
          const payloadHash = sha256Text(
            row.payload_text,
          );

          if (
            payloadHash !== row.payload_hash
          ) {
            addIssue({
              code: "payload_hash_mismatch",
              message:
                `Immutable source payload no longer matches the committed hash at sequence ${sequence}.`,
              sequence,
              sourceTable: row.source_table,
              sourceKey: row.source_key,
            });
          }
        }

        const expectedHash =
          computeIntegrityEntryHash({
            registryId,
            sequence,
            sourceTable: row.source_table,
            sourceKey: row.source_key,
            payloadHash: row.payload_hash,
            previousHash:
              row.previous_hash ?? undefined,
          });

        if (expectedHash !== row.entry_hash) {
          addIssue({
            code: "entry_hash_mismatch",
            message:
              `Integrity entry ${sequence} has an invalid chain hash.`,
            sequence,
            sourceTable: row.source_table,
            sourceKey: row.source_key,
          });
        }

        previousHash = row.entry_hash;
        expectedSequence = sequence + 1;
        afterSequence = sequence;
        verifiedEntries += 1;
      }

      if (result.rows.length < batchSize) {
        break;
      }
    }

    const missing =
      await this.pool.query<MissingSourceRow>(
        `
          SELECT
            source.source_table,
            source.source_key
          FROM civic_registry_integrity_sources
            AS source
          LEFT JOIN civic_registry_integrity_entries
            AS entry
            ON entry.registry_id =
                source.registry_id
            AND entry.source_table =
                source.source_table
            AND entry.source_key =
                source.source_key
          WHERE source.registry_id = $1
            AND entry.sequence IS NULL
          ORDER BY
            source.occurred_at ASC,
            source.source_table ASC,
            source.source_key ASC
          LIMIT $2
        `,
        [registryId, issueLimit + 1],
      );

    for (
      const row of missing.rows.slice(
        0,
        Math.max(
          0,
          issueLimit - issues.length,
        ),
      )
    ) {
      addIssue({
        code: "source_not_chained",
        message:
          "An immutable history source row is missing from the integrity ledger.",
        sourceTable: row.source_table,
        sourceKey: row.source_key,
      });
    }

    if (
      summary.sequence !== verifiedEntries
    ) {
      addIssue({
        code: "head_sequence_mismatch",
        message:
          `Integrity head sequence ${summary.sequence} does not match ${verifiedEntries} verified ledger entries.`,
      });
    }

    if (
      summary.entryCount !== verifiedEntries
    ) {
      addIssue({
        code: "head_sequence_mismatch",
        message:
          `Ledger count ${summary.entryCount} does not match ${verifiedEntries} contiguous verified entries.`,
      });
    }

    if (
      summary.sourceCount !==
      summary.entryCount
    ) {
      addIssue({
        code: "source_not_chained",
        message:
          `Immutable source count ${summary.sourceCount} does not match ledger entry count ${summary.entryCount}.`,
      });
    }

    if (
      summary.headHash !== previousHash
    ) {
      addIssue({
        code: "head_hash_mismatch",
        message:
          "Stored integrity head does not match the final ledger entry.",
      });
    }

    return {
      ...summary,
      valid: issues.length === 0,
      verifiedEntries,
      issues,
    };
  }

  async createSignedCheckpoint(
    registryId: string,
    privateKeyPem: string,
    options: {
      generatedAt?: string;
      keyId?: string;
      backupFilePath?: string;
    } = {},
  ): Promise<SignedIntegrityCheckpoint> {
    const integrity =
      await this.verifyRegistry(registryId);

    if (!integrity.valid) {
      throw new Error(
        "Cannot sign an integrity checkpoint while registry verification is failing.",
      );
    }

    const key = createPrivateKey(
      normalizePem(privateKeyPem),
    );
    const backup = options.backupFilePath
      ? await sha256File(
          options.backupFilePath,
        )
      : undefined;
    const unsigned: Omit<
      SignedIntegrityCheckpoint,
      "signature"
    > = {
      formatVersion: 1,
      chainAlgorithm: "sha256",
      chainFormat:
        "civic-registry-integrity-v1",
      signatureAlgorithm: "ed25519",
      registryId,
      sequence: integrity.sequence,
      headHash: integrity.headHash,
      entryCount: integrity.entryCount,
      sourceCount: integrity.sourceCount,
      recordVersionCount:
        integrity.recordVersionCount,
      auditEventCount:
        integrity.auditEventCount,
      generatedAt:
        options.generatedAt ??
        new Date().toISOString(),
      keyId:
        options.keyId?.trim() ||
        publicKeyId(key),
      backup,
    };

    const signature = sign(
      null,
      Buffer.from(
        checkpointSigningPayload(unsigned),
        "utf8",
      ),
      key,
    ).toString("base64");

    return {
      ...unsigned,
      signature,
    };
  }

  async verifySignedCheckpoint(
    checkpoint: SignedIntegrityCheckpoint,
    publicKeyPem: string,
    options: {
      backupFilePath?: string;
    } = {},
  ): Promise<CheckpointVerificationResult> {
    const issues: string[] = [];
    const signatureValid =
      verifyIntegrityCheckpointSignature(
        checkpoint,
        publicKeyPem,
      );

    if (!signatureValid) {
      issues.push(
        "Checkpoint Ed25519 signature is invalid.",
      );
    }

    const current =
      await this.verifyRegistry(
        checkpoint.registryId,
      );

    if (!current.valid) {
      issues.push(
        "Current registry integrity verification is failing.",
      );
    }

    let anchorMatches = false;

    if (checkpoint.sequence === 0) {
      anchorMatches =
        checkpoint.headHash === undefined &&
        current.sequence >= 0;
    } else {
      const anchor =
        await this.pool.query<{
          entry_hash: string;
        }>(
          `
            SELECT entry_hash
            FROM civic_registry_integrity_entries
            WHERE registry_id = $1
              AND sequence = $2
          `,
          [
            checkpoint.registryId,
            checkpoint.sequence,
          ],
        );

      anchorMatches =
        anchor.rows[0]?.entry_hash ===
        checkpoint.headHash;
    }

    if (!anchorMatches) {
      issues.push(
        "Signed checkpoint does not match the current chain at its anchored sequence.",
      );
    }

    let backupVerified: boolean | undefined;

    if (
      checkpoint.backup &&
      options.backupFilePath
    ) {
      const currentBackup =
        await sha256File(
          options.backupFilePath,
        );

      backupVerified =
        currentBackup.sha256 ===
          checkpoint.backup.sha256 &&
        currentBackup.sizeBytes ===
          checkpoint.backup.sizeBytes;

      if (!backupVerified) {
        issues.push(
          "Backup file does not match the signed checkpoint binding.",
        );
      }
    }

    return {
      valid:
        signatureValid &&
        anchorMatches &&
        current.valid &&
        backupVerified !== false,
      signatureValid,
      anchorMatches,
      backupVerified,
      currentIntegrityValid: current.valid,
      currentSequence: current.sequence,
      currentHeadHash: current.headHash,
      issues,
    };
  }
}
