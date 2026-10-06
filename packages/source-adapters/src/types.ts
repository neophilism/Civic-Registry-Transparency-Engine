export interface SourceAdapterWarning {
  code: string;
  message: string;
  url?: string;
}

export interface SourceAdapterAttachment {
  url: string;
  label?: string;
  mediaType?: string;
}

export interface SourceAdapterRow
  extends Record<
    string,
    string | string[] | number | boolean | null | undefined
  > {
  id: string;
  external_id: string;
  title: string;
  canonical_url: string;
  source_adapter: string;
  retrieved_at: string;
  attachment_urls?: string[];
}

export interface DiscoveredSourceItem {
  url: string;
  titleHint?: string;
  summaryHint?: string;
  issuedOnHint?: string;
  metadata?: Record<string, string>;
}

export interface SourceAdapterCollection {
  rows: SourceAdapterRow[];
  sourcePages: string[];
  warnings: SourceAdapterWarning[];
}

export interface SourceAdapterRunOptions {
  startUrls?: string[];
  maxItems?: number;
  maxPages?: number;
  retrievedAt?: string;
}

export interface SourceAdapter {
  id: string;
  label: string;
  allowedHosts: readonly string[];
  defaultStartUrls: readonly string[];
  collect(
    client: PublicSourceClient,
    options?: SourceAdapterRunOptions,
  ): Promise<SourceAdapterCollection>;
}

export interface PublicSourceFetchResult {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  body: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
}

export interface PublicSourceClient {
  fetchText(
    url: string,
    allowedHosts: readonly string[],
  ): Promise<PublicSourceFetchResult>;
}

export interface PublicSourceClientOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  dnsLookup?: (
    hostname: string,
  ) => Promise<
    Array<{
      address: string;
      family: number;
    }>
  >;
}

export interface SourceAdapterRunManifest {
  formatVersion: 1;
  adapterId: string;
  adapterLabel: string;
  retrievedAt: string;
  rowCount: number;
  sourcePages: string[];
  warnings: SourceAdapterWarning[];
  outputSha256: string;
}
