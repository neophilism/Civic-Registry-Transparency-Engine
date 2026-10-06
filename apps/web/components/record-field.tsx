import type {
  FieldValue,
} from "@civic-registry/core";
import type { PresentedField } from "@civic-registry/registry";
import Link from "next/link";

function isStringArray(
  value: FieldValue | undefined,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

export function RecordFieldValue({
  field,
  registryId,
}: {
  field: PresentedField;
  registryId: string;
}) {
  if (field.disclosure) {
    return (
      <span className="disclosure-value">
        <strong>{field.displayValue}</strong>
        {field.disclosure.publicNote ? (
          <small>{field.disclosure.publicNote}</small>
        ) : null}
        {field.disclosure.reason ? (
          <small>
            Reason: {field.disclosure.reason}
          </small>
        ) : null}
        {field.disclosure.authority ? (
          <small>
            Authority: {field.disclosure.authority}
          </small>
        ) : null}
      </span>
    );
  }

  if (field.empty) {
    return <span className="empty-value">Not provided</span>;
  }

  if (
    field.type === "entityRef" &&
    typeof field.rawValue === "string"
  ) {
    return (
      <Link
        href={`/registries/${encodeURIComponent(
          registryId,
        )}/records/${encodeURIComponent(field.rawValue)}`}
      >
        {field.displayValue}
      </Link>
    );
  }

  if (
    field.type === "entityRefList" &&
    isStringArray(field.rawValue)
  ) {
    return (
      <span className="inline-links">
        {field.rawValue.map((recordId) => (
          <Link
            key={recordId}
            href={`/registries/${encodeURIComponent(
              registryId,
            )}/records/${encodeURIComponent(recordId)}`}
          >
            {recordId}
          </Link>
        ))}
      </span>
    );
  }

  if (
    field.type === "url" &&
    typeof field.rawValue === "string"
  ) {
    return (
      <a
        href={field.rawValue}
        target="_blank"
        rel="noreferrer"
      >
        {field.rawValue}
      </a>
    );
  }

  if (
    field.type === "email" &&
    typeof field.rawValue === "string"
  ) {
    return (
      <a href={`mailto:${field.rawValue}`}>
        {field.rawValue}
      </a>
    );
  }

  return <span>{field.displayValue}</span>;
}
