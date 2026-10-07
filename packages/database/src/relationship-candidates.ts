
import {
  createHash,
} from "node:crypto";

import {
  compileRegistryConfig,
} from "@civic-registry/config";
import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  PersistenceNotFoundError,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
} from "./repositories.ts";

export type RelationshipCandidateStatus =
  | "pending"
  | "approved"
  | "rejected";

export interface RelationshipCandidate {
  id: string;
  registryId: string;
  relationshipTypeId: string;
  fromRecordId: string;
  toRecordId: string;
  status: RelationshipCandidateStatus;
  extractor: string;
  extractorVersion: string;
  confidence: number;
  evidence: Record<string, unknown>;
  evidenceSha256: string;
  metadata: Record<string, unknown>;
  proposedAt: string;
  proposedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  relationshipId?: string;
}

export interface RelationshipCandidateProposal {
  id: string;
  registryId: string;
  relationshipTypeId: string;
  fromRecordId: string;
  toRecordId: string;
  extractor: string;
  extractorVersion: string;
  confidence: number;
  evidence: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  proposedAt?: string;
  proposedBy?: string;
}

export type RelationshipCandidateProposalResult =
  | {
      kind: "candidate";
      candidate: RelationshipCandidate;
      created: boolean;
    }
  | {
      kind: "relationship_exists";
      relationshipId: string;
    };

export interface RelationshipCandidateListOptions {
  status?: RelationshipCandidateStatus;
  relationshipTypeId?: string;
  fromRecordId?: string;
  toRecordId?: string;
  limit?: number;
  offset?: number;
}

export interface RelationshipCandidateReviewInput {
  registryId: string;
  candidateId: string;
  decision: "approved" | "rejected";
  actorId: string;
  note?: string;
  reason?: string;
  reviewedAt?: string;
}

export interface RelationshipCandidateReviewResult {
  candidate: RelationshipCandidate;
  relationshipId?: string;
}

interface CandidateRow extends QueryResultRow {
  registry_id: string;
  id: string;
  relationship_type_id: string;
  from_record_id: string;
  to_record_id: string;
  status: RelationshipCandidateStatus;
  extractor: string;
  extractor_version: string;
  confidence: string | number;
  evidence: Record<string, unknown>;
  evidence_sha256: string;
  metadata: Record<string, unknown>;
  proposed_at: Date;
  proposed_by: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_note: string | null;
  relationship_id: string | null;
}

function mapCandidate(
  row: CandidateRow,
): RelationshipCandidate {
  return {
    id: row.id,
    registryId: row.registry_id,
    relationshipTypeId:
      row.relationship_type_id,
    fromRecordId:
      row.from_record_id,
    toRecordId:
      row.to_record_id,
    status: row.status,
    extractor: row.extractor,
    extractorVersion:
      row.extractor_version,
    confidence:
      Number(row.confidence),
    evidence: row.evidence ?? {},
    evidenceSha256:
      row.evidence_sha256,
    metadata: row.metadata ?? {},
    proposedAt:
      row.proposed_at.toISOString(),
    proposedBy:
      row.proposed_by ?? undefined,
    reviewedAt:
      row.reviewed_at?.toISOString(),
    reviewedBy:
      row.reviewed_by ?? undefined,
    reviewNote:
      row.review_note ?? undefined,
    relationshipId:
      row.relationship_id ?? undefined,
  };
}

function stableValue(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>,
      )
        .filter(
          ([, entry]) =>
            entry !== undefined,
        )
        .sort(([left], [right]) =>
          left.localeCompare(right),
        )
        .map(([key, entry]) => [
          key,
          stableValue(entry),
        ]),
    );
  }

  return value;
}

function stableJson(
  value: unknown,
): string {
  return JSON.stringify(
    stableValue(value),
  );
}

function sha256(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function relationshipCandidateEvidenceHash(
  evidence: Record<string, unknown>,
): string {
  return sha256(
    stableJson(evidence),
  );
}

function normalizeDateTime(
  value: string | undefined,
  label: string,
): string {
  const parsed =
    value === undefined
      ? new Date()
      : new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(
      label +
        " must be a valid date-time.",
    );
  }

  return parsed.toISOString();
}

function normalizeConfidence(
  value: number,
): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      "Relationship candidate confidence must be between 0 and 1.",
    );
  }

  return Math.round(value * 10_000) /
    10_000;
}

function clampLimit(
  value: number | undefined,
): number {
  return Math.max(
    1,
    Math.min(
      Math.trunc(value ?? 100),
      500,
    ),
  );
}

function normalizeOffset(
  value: number | undefined,
): number {
  return Math.max(
    0,
    Math.trunc(value ?? 0),
  );
}

function stableRelationshipId(
  candidate: RelationshipCandidate,
): string {
  return (
    "candidate-rel-" +
    sha256(
      [
        candidate.registryId,
        candidate.id,
      ].join("|"),
    ).slice(0, 32)
  );
}

async function setHistoryContext(
  client: PoolClient,
  actorId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `
      SELECT
        set_config(
          'civic_registry.actor_id',
          $1,
          true
        ),
        set_config(
          'civic_registry.reason',
          $2,
          true
        )
    `,
    [
      actorId.trim(),
      reason.trim(),
    ],
  );
}

export class PostgresRelationshipCandidateService {
  private readonly pool: Pool;
  private readonly configs:
    PostgresRegistryConfigRepository;
  private readonly records:
    PostgresRecordRepository;

  constructor(pool: Pool) {
    this.pool = pool;
    this.configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    this.records =
      new PostgresRecordRepository(
        pool,
        this.configs,
      );
  }

  private async validateProposal(
    input: RelationshipCandidateProposal,
  ): Promise<void> {
    const config =
      await this.configs.get(
        input.registryId,
      );

    if (!config) {
      throw new PersistenceNotFoundError(
        "Registry configuration " +
          input.registryId +
          " does not exist.",
      );
    }

    const compiled =
      compileRegistryConfig(config);
    const relationshipType =
      compiled.relationshipTypesById.get(
        input.relationshipTypeId,
      );

    if (!relationshipType) {
      throw new Error(
        "Unknown relationship type: " +
          input.relationshipTypeId +
          ".",
      );
    }

    const [from, to] =
      await Promise.all([
        this.records.get(
          input.registryId,
          input.fromRecordId,
        ),
        this.records.get(
          input.registryId,
          input.toRecordId,
        ),
      ]);

    if (!from || !to) {
      throw new PersistenceNotFoundError(
        "Both relationship candidate endpoints must exist.",
      );
    }

    if (
      relationshipType
        .fromRecordTypeIds?.length &&
      !relationshipType
        .fromRecordTypeIds.includes(
          from.recordTypeId,
        )
    ) {
      throw new Error(
        "Record type " +
          from.recordTypeId +
          " is not allowed as the source of relationship " +
          relationshipType.id +
          ".",
      );
    }

    if (
      relationshipType
        .toRecordTypeIds?.length &&
      !relationshipType
        .toRecordTypeIds.includes(
          to.recordTypeId,
        )
    ) {
      throw new Error(
        "Record type " +
          to.recordTypeId +
          " is not allowed as the target of relationship " +
          relationshipType.id +
          ".",
      );
    }
  }

  private async equivalentRelationshipId(
    registryId: string,
    relationshipTypeId: string,
    fromRecordId: string,
    toRecordId: string,
    client: Pool | PoolClient = this.pool,
  ): Promise<string | undefined> {
    const result =
      await client.query<{
        id: string;
      }>(
        `
          SELECT id
          FROM civic_registry_relationships
          WHERE registry_id = $1
            AND relationship_type_id = $2
            AND from_record_id = $3
            AND to_record_id = $4
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `,
        [
          registryId,
          relationshipTypeId,
          fromRecordId,
          toRecordId,
        ],
      );

    return result.rows[0]?.id;
  }

  async get(
    registryId: string,
    candidateId: string,
  ): Promise<RelationshipCandidate | null> {
    const result =
      await this.pool.query<CandidateRow>(
        `
          SELECT *
          FROM civic_registry_relationship_candidates
          WHERE registry_id = $1
            AND id = $2
        `,
        [
          registryId,
          candidateId,
        ],
      );

    return result.rows[0]
      ? mapCandidate(
          result.rows[0],
        )
      : null;
  }

  async list(
    registryId: string,
    options:
      RelationshipCandidateListOptions = {},
  ): Promise<RelationshipCandidate[]> {
    const values: unknown[] = [
      registryId,
    ];
    const where = [
      "registry_id = $1",
    ];

    const add = (
      column: string,
      value: string | undefined,
    ) => {
      if (!value) return;
      values.push(value);
      where.push(
        column +
          " = $" +
          values.length,
      );
    };

    add(
      "status",
      options.status,
    );
    add(
      "relationship_type_id",
      options.relationshipTypeId,
    );
    add(
      "from_record_id",
      options.fromRecordId,
    );
    add(
      "to_record_id",
      options.toRecordId,
    );

    values.push(
      clampLimit(options.limit),
    );
    const limit =
      "$" + values.length;
    values.push(
      normalizeOffset(
        options.offset,
      ),
    );
    const offset =
      "$" + values.length;

    const result =
      await this.pool.query<CandidateRow>(
        `
          SELECT *
          FROM civic_registry_relationship_candidates
          WHERE ` +
          where.join(" AND ") +
          `
          ORDER BY
            CASE status
              WHEN 'pending' THEN 0
              WHEN 'approved' THEN 1
              ELSE 2
            END,
            proposed_at DESC,
            id ASC
          LIMIT ` +
          limit +
          `
          OFFSET ` +
          offset,
        values,
      );

    return result.rows.map(
      mapCandidate,
    );
  }

  async propose(
    input: RelationshipCandidateProposal,
  ): Promise<RelationshipCandidateProposalResult> {
    const id = input.id.trim();
    const registryId =
      input.registryId.trim();
    const relationshipTypeId =
      input.relationshipTypeId.trim();
    const fromRecordId =
      input.fromRecordId.trim();
    const toRecordId =
      input.toRecordId.trim();
    const extractor =
      input.extractor.trim();
    const extractorVersion =
      input.extractorVersion.trim();
    const proposedBy =
      input.proposedBy?.trim() ||
      undefined;

    if (
      !id ||
      !registryId ||
      !relationshipTypeId ||
      !fromRecordId ||
      !toRecordId ||
      !extractor ||
      !extractorVersion
    ) {
      throw new Error(
        "Relationship candidate identifiers, extractor, and extractor version must be non-empty.",
      );
    }

    const normalized = {
      ...input,
      id,
      registryId,
      relationshipTypeId,
      fromRecordId,
      toRecordId,
      extractor,
      extractorVersion,
      confidence:
        normalizeConfidence(
          input.confidence,
        ),
      evidence:
        input.evidence ?? {},
      metadata:
        input.metadata ?? {},
      proposedAt:
        normalizeDateTime(
          input.proposedAt,
          "proposedAt",
        ),
      proposedBy,
    };

    await this.validateProposal(
      normalized,
    );

    const existingRelationship =
      await this.equivalentRelationshipId(
        registryId,
        relationshipTypeId,
        fromRecordId,
        toRecordId,
      );

    if (existingRelationship) {
      return {
        kind:
          "relationship_exists",
        relationshipId:
          existingRelationship,
      };
    }

    const evidenceSha256 =
      relationshipCandidateEvidenceHash(
        normalized.evidence,
      );
    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      const result =
        await client.query<CandidateRow>(
          `
            INSERT INTO civic_registry_relationship_candidates (
              registry_id,
              id,
              relationship_type_id,
              from_record_id,
              to_record_id,
              status,
              extractor,
              extractor_version,
              confidence,
              evidence,
              evidence_sha256,
              metadata,
              proposed_at,
              proposed_by
            )
            VALUES (
              $1, $2, $3, $4, $5,
              'pending',
              $6, $7, $8,
              $9::jsonb, $10,
              $11::jsonb,
              $12::timestamptz,
              $13
            )
            ON CONFLICT (
              registry_id,
              id
            )
            DO NOTHING
            RETURNING *
          `,
          [
            registryId,
            id,
            relationshipTypeId,
            fromRecordId,
            toRecordId,
            extractor,
            extractorVersion,
            normalized.confidence,
            JSON.stringify(
              normalized.evidence,
            ),
            evidenceSha256,
            JSON.stringify(
              normalized.metadata,
            ),
            normalized.proposedAt,
            proposedBy ?? null,
          ],
        );

      if (!result.rows[0]) {
        const existingResult =
          await client.query<CandidateRow>(
            `
              SELECT *
              FROM civic_registry_relationship_candidates
              WHERE registry_id = $1
                AND id = $2
            `,
            [
              registryId,
              id,
            ],
          );
        const existing =
          existingResult.rows[0];

        if (!existing) {
          throw new Error(
            "Relationship candidate conflict could not be resolved.",
          );
        }

        await client.query("COMMIT");

        return {
          kind: "candidate",
          candidate:
            mapCandidate(
              existing,
            ),
          created: false,
        };
      }

      const candidate =
        mapCandidate(
          result.rows[0],
        );

      await client.query(
        `
          INSERT INTO civic_registry_audit_events (
            registry_id,
            subject_type,
            subject_id,
            event_type,
            occurred_at,
            visibility,
            actor_id,
            reason,
            metadata
          )
          VALUES (
            $1,
            'record',
            $2,
            'relationship_candidate.proposed',
            $3::timestamptz,
            'private',
            $4,
            $5,
            $6::jsonb
          )
        `,
        [
          registryId,
          fromRecordId,
          candidate.proposedAt,
          proposedBy ?? null,
          "Relationship candidate proposed by " +
            extractor +
            ".",
          JSON.stringify({
            candidateId:
              candidate.id,
            relationshipTypeId:
              candidate.relationshipTypeId,
            toRecordId:
              candidate.toRecordId,
            extractor:
              candidate.extractor,
            extractorVersion:
              candidate.extractorVersion,
            confidence:
              candidate.confidence,
            evidenceSha256:
              candidate.evidenceSha256,
          }),
        ],
      );

      await client.query("COMMIT");

      return {
        kind: "candidate",
        candidate,
        created: true,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async review(
    input: RelationshipCandidateReviewInput,
  ): Promise<RelationshipCandidateReviewResult> {
    const registryId =
      input.registryId.trim();
    const candidateId =
      input.candidateId.trim();
    const actorId =
      input.actorId.trim();
    const note =
      input.note?.trim() ||
      undefined;
    const reason =
      input.reason?.trim() ||
      (
        "Administrator reviewed relationship candidate " +
        candidateId +
        "."
      );
    const reviewedAt =
      normalizeDateTime(
        input.reviewedAt,
        "reviewedAt",
      );

    if (
      !registryId ||
      !candidateId ||
      !actorId
    ) {
      throw new Error(
        "registryId, candidateId, and actorId must be non-empty.",
      );
    }

    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      const candidateResult =
        await client.query<CandidateRow>(
          `
            SELECT *
            FROM civic_registry_relationship_candidates
            WHERE registry_id = $1
              AND id = $2
            FOR UPDATE
          `,
          [
            registryId,
            candidateId,
          ],
        );
      const row =
        candidateResult.rows[0];

      if (!row) {
        throw new PersistenceNotFoundError(
          "Relationship candidate " +
            registryId +
            "/" +
            candidateId +
            " does not exist.",
        );
      }

      const candidate =
        mapCandidate(row);

      if (
        candidate.status !==
        "pending"
      ) {
        throw new Error(
          "Only pending relationship candidates can be reviewed.",
        );
      }

      await this.validateProposal({
        id: candidate.id,
        registryId:
          candidate.registryId,
        relationshipTypeId:
          candidate.relationshipTypeId,
        fromRecordId:
          candidate.fromRecordId,
        toRecordId:
          candidate.toRecordId,
        extractor:
          candidate.extractor,
        extractorVersion:
          candidate.extractorVersion,
        confidence:
          candidate.confidence,
        evidence:
          candidate.evidence,
        metadata:
          candidate.metadata,
        proposedAt:
          candidate.proposedAt,
        proposedBy:
          candidate.proposedBy,
      });

      const currentEvidenceHash =
        relationshipCandidateEvidenceHash(
          candidate.evidence,
        );

      if (
        currentEvidenceHash !==
        candidate.evidenceSha256
      ) {
        throw new Error(
          "Relationship candidate evidence does not match its stored SHA-256.",
        );
      }

      const proposalAudit =
        await client.query<{
          evidence_sha256:
            string | null;
        }>(
          `
            SELECT
              metadata ->> 'evidenceSha256'
                AS evidence_sha256
            FROM civic_registry_audit_events
            WHERE registry_id = $1
              AND subject_type = 'record'
              AND subject_id = $2
              AND event_type =
                'relationship_candidate.proposed'
              AND metadata ->> 'candidateId' = $3
            ORDER BY id ASC
            LIMIT 1
          `,
          [
            registryId,
            candidate.fromRecordId,
            candidate.id,
          ],
        );

      if (
        proposalAudit.rows[0]
          ?.evidence_sha256 !==
        currentEvidenceHash
      ) {
        throw new Error(
          "Relationship candidate evidence no longer matches its immutable proposal audit event.",
        );
      }

      let relationshipId:
        string | undefined;

      if (
        input.decision ===
        "approved"
      ) {
        const lockKey = [
          candidate.registryId,
          candidate.relationshipTypeId,
          candidate.fromRecordId,
          candidate.toRecordId,
        ].join("|");

        await client.query(
          `
            SELECT pg_advisory_xact_lock(
              724918535,
              hashtext($1)
            )
          `,
          [lockKey],
        );

        relationshipId =
          await this.equivalentRelationshipId(
            candidate.registryId,
            candidate.relationshipTypeId,
            candidate.fromRecordId,
            candidate.toRecordId,
            client,
          );

        if (!relationshipId) {
          relationshipId =
            stableRelationshipId(
              candidate,
            );

          await setHistoryContext(
            client,
            actorId,
            reason,
          );

          await client.query(
            `
              INSERT INTO civic_registry_relationships (
                registry_id,
                id,
                relationship_type_id,
                from_record_id,
                to_record_id,
                created_at,
                metadata
              )
              VALUES (
                $1, $2, $3, $4, $5,
                $6::timestamptz,
                $7::jsonb
              )
            `,
            [
              candidate.registryId,
              relationshipId,
              candidate.relationshipTypeId,
              candidate.fromRecordId,
              candidate.toRecordId,
              reviewedAt,
              JSON.stringify({
                reviewedCandidateId:
                  candidate.id,
                source:
                  "relationship_candidate_review",
              }),
            ],
          );
        }
      }

      await client.query(
        `
          SELECT set_config(
            'civic_registry.relationship_candidate_review',
            'allowed',
            true
          )
        `,
      );

      const updated =
        await client.query<CandidateRow>(
          `
            UPDATE civic_registry_relationship_candidates
            SET
              status = $3,
              reviewed_at =
                $4::timestamptz,
              reviewed_by = $5,
              review_note = $6,
              relationship_id = $7
            WHERE registry_id = $1
              AND id = $2
            RETURNING *
          `,
          [
            registryId,
            candidateId,
            input.decision,
            reviewedAt,
            actorId,
            note ?? null,
            relationshipId ?? null,
          ],
        );

      await client.query(
        `
          INSERT INTO civic_registry_audit_events (
            registry_id,
            subject_type,
            subject_id,
            event_type,
            occurred_at,
            visibility,
            actor_id,
            reason,
            metadata
          )
          VALUES (
            $1,
            'record',
            $2,
            $3,
            $4::timestamptz,
            'private',
            $5,
            $6,
            $7::jsonb
          )
        `,
        [
          registryId,
          candidate.fromRecordId,
          input.decision ===
              "approved"
            ? "relationship_candidate.approved"
            : "relationship_candidate.rejected",
          reviewedAt,
          actorId,
          reason,
          JSON.stringify({
            candidateId:
              candidate.id,
            relationshipTypeId:
              candidate.relationshipTypeId,
            toRecordId:
              candidate.toRecordId,
            evidenceSha256:
              candidate.evidenceSha256,
            relationshipId:
              relationshipId ?? null,
            reviewNote:
              note ?? null,
          }),
        ],
      );

      await client.query("COMMIT");

      return {
        candidate:
          mapCandidate(
            updated.rows[0],
          ),
        relationshipId,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
