import type { CompiledRegistryConfig } from "@civic-registry/config";
import type { RegistryRecord } from "@civic-registry/core";

export interface SearchFieldFilter {
  fieldId: string;
  values: string[];
}

export interface SearchRangeFilter {
  fieldId: string;
  from?: string;
  to?: string;
}

export type SearchSortBy =
  | "relevance"
  | "updated"
  | "published"
  | "field";

export interface SearchSort {
  by: SearchSortBy;
  fieldId?: string;
  direction?: "asc" | "desc";
}

export type SearchProjection =
  | "internal"
  | "public";

export interface SearchRequest {
  registryId: string;
  projection?: SearchProjection;
  text?: string;
  recordTypeId?: string;
  statuses?: string[];
  tags?: string[];
  fieldFilters?: SearchFieldFilter[];
  rangeFilters?: SearchRangeFilter[];
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
  visibility?: RegistryRecord["visibility"];
}

export interface NormalizedSearchRequest
  extends Omit<
    SearchRequest,
    "page" | "pageSize" | "text" | "statuses" | "tags" | "fieldFilters" | "rangeFilters"
  > {
  text?: string;
  statuses: string[];
  tags: string[];
  fieldFilters: SearchFieldFilter[];
  rangeFilters: SearchRangeFilter[];
  page: number;
  pageSize: number;
}

export interface SearchHit {
  record: RegistryRecord;
  score: number | null;
}

export interface SearchFacetBucket {
  value: string;
  count: number;
}

export interface SearchTermsFacet {
  kind: "terms";
  id: string;
  label: string;
  buckets: SearchFacetBucket[];
}

export interface SearchRangeFacet {
  kind: "range";
  id: string;
  label: string;
  min: string | null;
  max: string | null;
}

export type SearchFacet = SearchTermsFacet | SearchRangeFacet;

export interface SearchFacets {
  recordTypes: SearchFacetBucket[];
  statuses: SearchFacetBucket[];
  tags: SearchFacetBucket[];
  fields: Record<string, SearchFacet>;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  facets: SearchFacets;
}

export interface SearchProvider {
  search(
    registry: CompiledRegistryConfig,
    request: SearchRequest,
  ): Promise<SearchResponse>;
}
