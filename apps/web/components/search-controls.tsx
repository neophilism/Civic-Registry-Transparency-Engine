import type {
  CompiledRecordTypeConfig,
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  SearchFacets,
  SearchTermsFacet,
} from "@civic-registry/search";
import Link from "next/link";

import {
  firstSearchValue,
  searchValues,
  type PublicSearchParams,
} from "../lib/search-params";

function optionLabel(
  field: CompiledRecordTypeConfig["definition"]["fields"][number],
  value: string,
): string {
  if (field.type === "boolean") {
    return value === "true"
      ? "Yes"
      : value === "false"
        ? "No"
        : value;
  }

  return (
    field.options?.find((option) => option.value === value)
      ?.label ?? value
  );
}

function SearchSelect({
  label,
  name,
  selected,
  options,
}: {
  label: string;
  name: string;
  selected?: string;
  options: Array<{
    value: string;
    label: string;
    count?: number;
  }>;
}) {
  return (
    <label className="search-field">
      <span>{label}</span>
      <select name={name} defaultValue={selected ?? ""}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.count !== undefined
              ? ` (${option.count})`
              : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchControls({
  registry,
  recordType,
  facets,
  params,
  action,
  includeRecordType = false,
}: {
  registry: CompiledRegistryConfig;
  recordType?: CompiledRecordTypeConfig;
  facets: SearchFacets;
  params: PublicSearchParams;
  action: string;
  includeRecordType?: boolean;
}) {
  const query = firstSearchValue(params.q) ?? "";
  const selectedStatus =
    searchValues(params.status)[0];
  const selectedTag = searchValues(params.tag)[0];
  const selectedSort =
    firstSearchValue(params.sort) ??
    (query ? "relevance" : "");
  const selectedOrder =
    firstSearchValue(params.order) ?? "";
  const selectedType =
    recordType?.definition.id ??
    firstSearchValue(params.type) ??
    "";

  const statusOptions = facets.statuses.map((bucket) => ({
    value: bucket.value,
    label:
      registry.publicationLifecycle?.statusesById.get(
        bucket.value,
      )?.label ?? bucket.value,
    count: bucket.count,
  }));
  const tagOptions = facets.tags.map((bucket) => ({
    value: bucket.value,
    label: bucket.value,
    count: bucket.count,
  }));

  const sortableFields =
    recordType?.definition.fields.filter(
      (field) => field.sortable,
    ) ?? [];

  return (
    <form
      className="search-panel"
      method="get"
      action={action}
    >
      {!includeRecordType && recordType ? (
        <input
          type="hidden"
          name="type"
          value={recordType.definition.id}
        />
      ) : null}

      <div className="search-query">
        <label htmlFor="registry-search-query">
          Search public records
        </label>
        <div>
          <input
            id="registry-search-query"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search titles, summaries, and other searchable fields"
          />
          <button type="submit">Search</button>
        </div>
      </div>

      <details
        className="search-filters"
        open={Boolean(
          selectedStatus ||
            selectedTag ||
            selectedSort ||
            Object.keys(params).some(
              (key) =>
                key.startsWith("f_") ||
                key.startsWith("from_") ||
                key.startsWith("to_"),
            ),
        )}
      >
        <summary>Filters and sorting</summary>

        <div className="search-filter-grid">
          {includeRecordType ? (
            <SearchSelect
              label="Record type"
              name="type"
              selected={selectedType}
              options={registry.definition.recordTypes.map(
                (type) => {
                  const count =
                    facets.recordTypes.find(
                      (bucket) => bucket.value === type.id,
                    )?.count;
                  return {
                    value: type.id,
                    label: type.pluralName,
                    count,
                  };
                },
              )}
            />
          ) : null}

          <SearchSelect
            label="Status"
            name="status"
            selected={selectedStatus}
            options={statusOptions}
          />

          <SearchSelect
            label="Tag"
            name="tag"
            selected={selectedTag}
            options={tagOptions}
          />

          {recordType
            ? recordType.definition.fields
                .filter((field) => field.filterable)
                .map((field) => {
                  const facet = facets.fields[field.id];

                  if (
                    field.type === "date" ||
                    field.type === "datetime" ||
                    field.type === "integer" ||
                    field.type === "decimal"
                  ) {
                    const inputType =
                      field.type === "date"
                        ? "date"
                        : field.type === "datetime"
                          ? "datetime-local"
                          : "number";

                    return (
                      <fieldset
                        className="search-range"
                        key={field.id}
                      >
                        <legend>{field.label}</legend>
                        <label>
                          <span>From</span>
                          <input
                            name={`from_${field.id}`}
                            type={inputType}
                            defaultValue={
                              firstSearchValue(
                                params[`from_${field.id}`],
                              ) ?? ""
                            }
                          />
                        </label>
                        <label>
                          <span>To</span>
                          <input
                            name={`to_${field.id}`}
                            type={inputType}
                            defaultValue={
                              firstSearchValue(
                                params[`to_${field.id}`],
                              ) ?? ""
                            }
                          />
                        </label>
                      </fieldset>
                    );
                  }

                  const terms =
                    facet?.kind === "terms"
                      ? (facet as SearchTermsFacet)
                      : undefined;

                  return (
                    <SearchSelect
                      key={field.id}
                      label={field.label}
                      name={`f_${field.id}`}
                      selected={
                        searchValues(
                          params[`f_${field.id}`],
                        )[0]
                      }
                      options={
                        terms?.buckets.map((bucket) => ({
                          value: bucket.value,
                          label: optionLabel(
                            field,
                            bucket.value,
                          ),
                          count: bucket.count,
                        })) ??
                        field.options?.map((option) => ({
                          value: option.value,
                          label: option.label,
                        })) ??
                        []
                      }
                    />
                  );
                })
            : null}

          <label className="search-field">
            <span>Sort by</span>
            <select
              name="sort"
              defaultValue={selectedSort}
            >
              <option value="">Default</option>
              {query ? (
                <option value="relevance">Relevance</option>
              ) : null}
              <option value="updated">Last updated</option>
              <option value="published">Published date</option>
              {sortableFields.map((field) => (
                <option
                  key={field.id}
                  value={`field:${field.id}`}
                >
                  {field.label}
                </option>
              ))}
            </select>
          </label>

          <label className="search-field">
            <span>Order</span>
            <select
              name="order"
              defaultValue={selectedOrder}
            >
              <option value="">Default</option>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>

        <div className="search-actions">
          <button type="submit">Apply filters</button>
          <Link href={action}>Clear</Link>
        </div>
      </details>
    </form>
  );
}
