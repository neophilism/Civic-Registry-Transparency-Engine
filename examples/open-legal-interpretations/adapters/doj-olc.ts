import {
  extractHeadingText,
  extractLinks,
  extractMetaContent,
  extractSectionAfterHeading,
  normalizeText,
  type DiscoveredSourceItem,
  type PublicSourceClient,
  type SourceAdapter,
  type SourceAdapterCollection,
  type SourceAdapterRunOptions,
  type SourceAdapterRow,
} from "@civic-registry/source-adapters";

import {
  parseUsDate,
  stableRecordId,
  summarize,
  uniqueStrings,
} from "./common.ts";

const ALLOWED_HOSTS = [
  "www.justice.gov",
  "justice.gov",
] as const;

const DEFAULT_START_URL =
  "https://www.justice.gov/olc/opinions";

function isOpinionUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      ALLOWED_HOSTS.includes(
        url.hostname as (typeof ALLOWED_HOSTS)[number],
      ) &&
      /\/olc\/opinion\/[^/]+\/?$/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

function dateHintFromText(
  value: string,
): string | undefined {
  const match = value.match(
    /Date of Issuance:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
  );

  return match?.[1];
}

export function discoverDojOlcOpinions(
  html: string,
  baseUrl: string,
): DiscoveredSourceItem[] {
  const items = new Map<
    string,
    DiscoveredSourceItem
  >();
  const headingPattern =
    /<h([2-4])\b[^>]*>\s*<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>\s*<\/h\1>/gi;
  const matches = [
    ...html.matchAll(headingPattern),
  ];

  for (
    let index = 0;
    index < matches.length;
    index += 1
  ) {
    const match = matches[index];
    const rawHref =
      match[2] ?? match[3];

    if (!rawHref) continue;

    const url = new URL(
      rawHref,
      baseUrl,
    ).toString();

    if (!isOpinionUrl(url)) continue;

    const start =
      (match.index ?? 0) +
      match[0].length;
    const end =
      matches[index + 1]?.index ??
      Math.min(
        html.length,
        start + 10_000,
      );
    const blockText = normalizeText(
      html.slice(start, end),
    );
    const title = normalizeText(
      match[4] ?? "",
    );
    const dateHint =
      dateHintFromText(blockText);
    const summary = summarize(
      blockText
        .replace(
          /Date of Issuance:\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}/i,
          "",
        )
        .trim(),
      1600,
    );

    items.set(url, {
      url,
      titleHint: title || undefined,
      summaryHint: summary,
      issuedOnHint: dateHint,
    });
  }

  if (items.size === 0) {
    for (const link of extractLinks(
      html,
      baseUrl,
    )) {
      if (!isOpinionUrl(link.href)) {
        continue;
      }

      items.set(link.href, {
        url: link.href,
        titleHint:
          link.text || undefined,
      });
    }
  }

  return [...items.values()];
}

function nextPageUrl(
  html: string,
  baseUrl: string,
): string | undefined {
  const link = extractLinks(
    html,
    baseUrl,
  ).find(
    (candidate) =>
      /^next(?:\s|$|›|»)/i.test(
        candidate.text,
      ) ||
      candidate.text === "›" ||
      candidate.text === "»",
  );

  if (!link) return undefined;

  try {
    const url = new URL(link.href);

    return ALLOWED_HOSTS.includes(
      url.hostname as (typeof ALLOWED_HOSTS)[number],
    )
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function opinionSlug(
  value: string,
): string {
  const url = new URL(value);
  const segments =
    url.pathname
      .split("/")
      .filter(Boolean);

  return (
    segments.at(-1) ??
    "opinion"
  );
}

export function parseDojOlcOpinion(
  html: string,
  url: string,
  retrievedAt: string,
  hint: DiscoveredSourceItem = {
    url,
  },
): SourceAdapterRow {
  const title =
    extractHeadingText(html, 1) ??
    hint.titleHint ??
    opinionSlug(url);
  const pageText = normalizeText(html);
  const issuedText =
    dateHintFromText(pageText) ??
    hint.issuedOnHint;
  const issuedOn =
    parseUsDate(issuedText);
  const headnotes =
    extractSectionAfterHeading(
      html,
      "Headnotes",
    );
  const description =
    extractMetaContent(
      html,
      "description",
    ) ??
    extractMetaContent(
      html,
      "og:description",
    ) ??
    hint.summaryHint;
  const summary =
    summarize(
      hint.summaryHint ??
        description ??
        headnotes,
    );
  const holding =
    summarize(
      headnotes ??
        hint.summaryHint ??
        description,
      5000,
    );
  const attachments =
    uniqueStrings(
      extractLinks(html, url)
        .filter((link) => {
          try {
            const parsed =
              new URL(link.href);

            return (
              ALLOWED_HOSTS.includes(
                parsed.hostname as (typeof ALLOWED_HOSTS)[number],
              ) &&
              (
                parsed.pathname
                  .toLowerCase()
                  .endsWith(".pdf") ||
                /\/file\/[^/]+\/dl\/?$/.test(
                  parsed.pathname,
                )
              )
            );
          } catch {
            return false;
          }
        })
        .map((link) => link.href),
    );
  const slug = opinionSlug(url);
  const externalId =
    \`doj-olc:\${slug}\`;

  return {
    id: stableRecordId(
      "doj-olc",
      slug,
    ),
    external_id: externalId,
    title,
    ...(summary
      ? { summary }
      : {}),
    interpretation_type:
      "formal_opinion",
    subject:
      "Office of Legal Counsel opinion",
    ...(issuedOn
      ? { issued_on: issuedOn }
      : {}),
    issuing_body:
      "usdoj-office-of-legal-counsel",
    ...(holding
      ? { key_holding: holding }
      : {}),
    source_reference: externalId,
    tags: [
      "official-source",
      "doj",
      "olc",
      "legal-opinion",
    ],
    canonical_url: url,
    source_adapter: "doj-olc",
    retrieved_at: retrievedAt,
    ...(attachments.length > 0
      ? {
          attachment_urls:
            attachments,
        }
      : {}),
  };
}

async function collectDojOlc(
  client: PublicSourceClient,
  options: SourceAdapterRunOptions = {},
): Promise<SourceAdapterCollection> {
  const maxPages = Math.max(
    1,
    Math.min(
      Math.trunc(
        options.maxPages ?? 5,
      ),
      50,
    ),
  );
  const maxItems = Math.max(
    1,
    Math.min(
      Math.trunc(
        options.maxItems ?? 100,
      ),
      2000,
    ),
  );
  const retrievedAt =
    options.retrievedAt ??
    new Date().toISOString();
  const startUrls =
    options.startUrls?.length
      ? options.startUrls
      : [DEFAULT_START_URL];
  const discovered = new Map<
    string,
    DiscoveredSourceItem
  >();
  const sourcePages: string[] = [];
  const warnings:
    SourceAdapterCollection["warnings"] =
      [];

  for (const startUrl of startUrls) {
    let current:
      | string
      | undefined = startUrl;
    const seenPages =
      new Set<string>();

    for (
      let page = 0;
      current &&
      page < maxPages &&
      discovered.size < maxItems;
      page += 1
    ) {
      if (seenPages.has(current)) {
        break;
      }

      seenPages.add(current);

      try {
        const response =
          await client.fetchText(
            current,
            ALLOWED_HOSTS,
          );
        sourcePages.push(
          response.finalUrl,
        );

        for (const item of
          discoverDojOlcOpinions(
            response.body,
            response.finalUrl,
          )) {
          if (
            discovered.size >= maxItems
          ) {
            break;
          }

          if (!discovered.has(item.url)) {
            discovered.set(
              item.url,
              item,
            );
          }
        }

        current = nextPageUrl(
          response.body,
          response.finalUrl,
        );
      } catch (error) {
        warnings.push({
          code:
            "catalog_fetch_failed",
          message:
            error instanceof Error
              ? error.message
              : "Unknown catalog fetch error.",
          url: current,
        });
        break;
      }
    }
  }

  const rows: SourceAdapterRow[] =
    [];

  for (const item of
    discovered.values()) {
    if (rows.length >= maxItems) break;

    try {
      const response =
        await client.fetchText(
          item.url,
          ALLOWED_HOSTS,
        );
      sourcePages.push(
        response.finalUrl,
      );
      rows.push(
        parseDojOlcOpinion(
          response.body,
          response.finalUrl,
          retrievedAt,
          item,
        ),
      );
    } catch (error) {
      warnings.push({
        code:
          "opinion_fetch_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unknown opinion fetch error.",
        url: item.url,
      });
    }
  }

  if (rows.length === 0) {
    warnings.push({
      code: "no_items_discovered",
      message:
        "No DOJ OLC opinion pages were discovered from the configured start pages.",
    });
  }

  return {
    rows,
    sourcePages,
    warnings,
  };
}

export const dojOlcAdapter:
  SourceAdapter = {
    id: "doj-olc",
    label:
      "U.S. Department of Justice Office of Legal Counsel opinions",
    allowedHosts: ALLOWED_HOSTS,
    defaultStartUrls: [
      DEFAULT_START_URL,
    ],
    collect: collectDojOlc,
  };
