import type { PresentedRecordSummary } from "@civic-registry/registry";
import Link from "next/link";

import { RecordFieldValue } from "./record-field";

export function RecordCard({
  record,
}: {
  record: PresentedRecordSummary;
}) {
  const secondaryFields = record.fields.filter(
    (field) =>
      field.id !== record.titleFieldId &&
      field.id !== record.summaryFieldId,
  );

  return (
    <article className="record-card">
      <div className="record-card__meta">
        <span>{record.recordTypeName}</span>
        <span>{record.statusLabel}</span>
      </div>

      <h3>
        <Link
          href={`/registries/${encodeURIComponent(
            record.registryId,
          )}/records/${encodeURIComponent(record.id)}`}
        >
          {record.title}
        </Link>
      </h3>

      {record.summary ? (
        <p className="record-card__summary">
          {record.summary}
        </p>
      ) : null}

      {secondaryFields.length > 0 ? (
        <dl className="record-card__fields">
          {secondaryFields.map((field) => (
            <div key={field.id}>
              <dt>{field.label}</dt>
              <dd>
                <RecordFieldValue
                  field={field}
                  registryId={record.registryId}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
