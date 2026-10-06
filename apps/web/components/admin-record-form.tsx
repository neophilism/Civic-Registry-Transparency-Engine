import type {
  CompiledRecordTypeConfig,
} from "@civic-registry/config";
import type {
  RegistryRecord,
} from "@civic-registry/core";

import {
  stringifyAdminFieldValue,
} from "../lib/admin-record";

interface AdminRecordFormProps {
  registryId: string;
  recordType: CompiledRecordTypeConfig;
  record?: RegistryRecord;
  action: (
    formData: FormData,
  ) => void | Promise<void>;
  returnTo: string;
  submitLabel: string;
}

function inputType(
  fieldType: string,
): string {
  switch (fieldType) {
    case "integer":
    case "decimal":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "url":
      return "url";
    case "email":
      return "email";
    default:
      return "text";
  }
}

export function AdminRecordForm({
  registryId,
  recordType,
  record,
  action,
  returnTo,
  submitLabel,
}: AdminRecordFormProps) {
  return (
    <form
      className="admin-form"
      action={action}
    >
      <input
        type="hidden"
        name="registryId"
        value={registryId}
      />
      <input
        type="hidden"
        name="recordTypeId"
        value={recordType.definition.id}
      />
      <input
        type="hidden"
        name="returnTo"
        value={returnTo}
      />
      {record ? (
        <input
          type="hidden"
          name="recordId"
          value={record.id}
        />
      ) : null}

      {!record ? (
        <label>
          <span>Record ID</span>
          <input
            name="recordId"
            placeholder="Leave blank to generate a UUID"
          />
        </label>
      ) : null}

      <div className="admin-form__grid">
        {recordType.definition.fields.map(
          (field) => {
            const value =
              record?.fields[field.id];
            const rendered =
              stringifyAdminFieldValue(
                field,
                value,
              );
            const name = "field." + field.id;

            if (field.type === "boolean") {
              return (
                <label
                  className="admin-checkbox"
                  key={field.id}
                >
                  <input
                    type="checkbox"
                    name={name}
                    defaultChecked={value === true}
                  />
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                </label>
              );
            }

            if (field.type === "enum") {
              return (
                <label key={field.id}>
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <select
                    name={name}
                    defaultValue={
                      typeof rendered === "string"
                        ? rendered
                        : ""
                    }
                    required={field.required}
                  >
                    <option value="">
                      Select…
                    </option>
                    {(field.options ?? []).map(
                      (option) => (
                        <option
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              );
            }

            if (field.type === "multiEnum") {
              return (
                <label key={field.id}>
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <select
                    name={name}
                    multiple
                    defaultValue={
                      Array.isArray(rendered)
                        ? rendered
                        : []
                    }
                    required={field.required}
                  >
                    {(field.options ?? []).map(
                      (option) => (
                        <option
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              );
            }

            if (
              field.type === "longText" ||
              field.type === "json" ||
              field.type === "entityRefList"
            ) {
              return (
                <label
                  className="admin-form__wide"
                  key={field.id}
                >
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <textarea
                    name={name}
                    rows={
                      field.type === "json"
                        ? 8
                        : 4
                    }
                    defaultValue={
                      typeof rendered === "string"
                        ? rendered
                        : ""
                    }
                    required={field.required}
                  />
                  {field.type ===
                  "entityRefList" ? (
                    <small>
                      Enter record IDs separated by
                      commas or new lines.
                    </small>
                  ) : null}
                </label>
              );
            }

            return (
              <label key={field.id}>
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <input
                  name={name}
                  type={inputType(field.type)}
                  step={
                    field.type === "decimal"
                      ? "any"
                      : undefined
                  }
                  defaultValue={
                    typeof rendered === "string"
                      ? rendered
                      : ""
                  }
                  required={field.required}
                />
                {field.description ? (
                  <small>{field.description}</small>
                ) : null}
              </label>
            );
          },
        )}
      </div>

      <div className="admin-form__grid admin-form__meta">
        <label>
          <span>Visibility</span>
          <select
            name="visibility"
            defaultValue={
              record?.visibility ?? "private"
            }
          >
            <option value="public">Public</option>
            <option value="restricted">
              Restricted
            </option>
            <option value="private">Private</option>
            <option value="embargoed">
              Embargoed
            </option>
          </select>
        </label>

        <label>
          <span>Tags</span>
          <input
            name="tags"
            defaultValue={
              record?.tags?.join(", ") ?? ""
            }
            placeholder="comma, separated, tags"
          />
        </label>

        <label className="admin-form__wide">
          <span>External identifiers</span>
          <textarea
            name="externalIdentifiers"
            rows={5}
            defaultValue={JSON.stringify(
              record?.externalIdentifiers ?? [],
              null,
              2,
            )}
          />
          <small>
            JSON array of scheme/value/url objects.
          </small>
        </label>

        <label className="admin-form__wide">
          <span>Audit reason</span>
          <input
            name="reason"
            placeholder="Why this administrative change is being made"
          />
        </label>
      </div>

      <div className="admin-actions">
        <button type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
