import {
  extractHeadingText,
  extractLinks,
  extractMetaContent,
  extractParagraphs,
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
  "www.oge.gov",
  "oge.gov",
  "www2.oge.gov",
] as const;

const DEFAULT_START_URLS = [
  "https://www.oge.gov/web/OGE.nsf/Legal%20Research%20Search%20Collection",
  "https://www.oge.gov/web/oge.nsf/Resources/Electronic%2BRecords%2BRoom",
] as const;

function advisoryIdFrom(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (!value) continue;

    const decoded = (() => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })();
    const match = decoded.match(
      /\bLA-\d{2}-\d{2}\b/i,
    );

    if (match) {
      return match[0].toUpperCase();
    }
  }

  return undefined;
}

function isResourceAdvisoryUrl(
  value: string,
): boolean {
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(
      url.pathname,
    );

    return (
      ALLOWED_HOSTS.includes(
        url.hostname as (typeof ALLOWED_HOSTS)[number],
      ) &&
      /\/Resources\/LA-\d{2}-\d{2}(?:[:/]|$)/i.test(
        decoded,
      )
    );
  } catch {
    return false;
  }
}

function rawResourceUrls(
  html: string,
  baseUrl: string,
): string[] {
  const urls: string[] = [];
  const patterns = [
    /https:\/\/(?:www2?\.)?oge\.gov\/web\/oge\.nsf\/Resources\/LA-[^"'<>\\\s]+/gi,
    /\/web\/oge\.nsf\/Resources\/LA-[^"'<>\\\s]+/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[0]
        .replace(/&amp;/gi, "&")
        .replace(/[),.;]+$/, "");

      try {
        urls.push(
          new URL(
            raw,
            baseUrl,
          ).toString(),
        );
      } catch {
        // Ignore malformed embedded URLs.
      }
    }
  }

  return urls;
}

export function discoverOgeLegalAdvisories(
  html: string,
  baseUrl: string,
): DiscoveredSourceItem[] {
  const items = new Map<
    string,
    DiscoveredSourceItem
  >();

  for (const link of extractLinks(
    html,
    baseUrl,
  )) {
    if (
      !isResourceAdvisoryUrl(
        link.href,
      )
    ) {
      continue;
    }

    items.set(link.href, {
      url: link.href,
      titleHint:
        link.text || undefined,
    });
  }

  for (const url of rawResourceUrls(
    html,
    baseUrl,
  )) {
    if (
      isResourceAdvisoryUrl(url) &&
      !items.has(url)
    ) {
      items.set(url, {
        url,
      });
    }
  }

  if (
    isResourceAdvisoryUrl(baseUrl) &&
    !items.has(baseUrl)
  ) {
    items.set(baseUrl, {
      url: baseUrl,
    });
  }

  return [...items.values()];
}

function firstUsefulParagraph(
  html: string,
): string | undefined {
  return extractParagraphs(html).find(
    (paragraph) =>
      paragraph.length >= 40 &&
      !/contactoge@oge\.gov/i.test(
        paragraph,
      ) &&
      !/^share\b/i.test(paragraph),
  );
}

export function parseOgeLegalAdvisory(
  html: string,
  url: string,
  retrievedAt: string,
  hint: DiscoveredSourceItem = {
    url,
  },
): SourceAdapterRow {
  const heading =
    extractHeadingText(html, 1) ??
    hint.titleHint ??
    "OGE Legal Advisory";
  const advisoryId =
    advisoryIdFrom(
      heading,
      hint.titleHint,
      url,
    );

  if (!advisoryId) {
    throw new Error(
      "OGE Legal Advisory page does not expose an LA-YY-NN identifier.",
    );
  }

  const title = heading
    .replace(
      new RegExp(
        "^" + advisoryId + "\\s*:\\s*",
        "i",
      ),
      "",
    )
    .trim() || heading;
  const paragraphs =
    extractParagraphs(html);
  const dateText =
    paragraphs
      .map((paragraph) =>
        paragraph.match(
          /\b[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/,
        )?.[0],
      )
      .find(Boolean) ??
    html.match(
      /\b[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/,
    )?.[0];
  const issuedOn =
    parseUsDate(dateText);
  const summary =
    summarize(
      extractMetaContent(
        html,
        "description",
      ) ??
        extractMetaContent(
          html,
          "og:description",
        ) ??
        firstUsefulParagraph(html),
      1600,
    );
  const attachments =
    uniqueStrings(
      extractLinks(html, url)
        .filter((link) => {
          try {
            const parsed =
              new URL(link.href);
            const decoded =
              decodeURIComponent(
                parsed.pathname,
              );

            return (
              ALLOWED_HOSTS.includes(
                parsed.hostname as (typeof ALLOWED_HOSTS)[number],
              ) &&
              (
                decoded
                  .toLowerCase()
                  .endsWith(".pdf") ||
                /\/\$FILE\/.*\.pdf$/i.test(
                  decoded,
                )
              ) &&
              (
                link.href
                  .toUpperCase()
                  .includes(
                    advisoryId,
                  ) ||
                decoded
                  .toUpperCase()
                  .includes(
                    advisoryId,
                  )
              )
            );
          } catch {
            return false;
          }
        })
        .map((link) => link.href),
    );
  const externalId =
    `oge:${advisoryId}`;

  return {
    id: stableRecordId(
      "oge",
      advisoryId,
    ),
    external_id: externalId,
    title,
    interpretation_number:
      advisoryId,
    interpretation_type: "guidance",
    subject:
      "Executive branch government ethics",
    ...(issuedOn
      ? { issued_on: issuedOn }
      : {}),
    issuing_body:
      "us-office-government-ethics",
    ...(summary
      ? {
          summary,
          key_holding: summary,
        }
      : {}),
    source_reference: externalId,
    tags: [
      "official-source",
      "oge",
      "legal-advisory",
      "government-ethics",
    ],
    canonical_url: url,
    source_adapter:
      "oge-legal-advisories",
    retrieved_at: retrievedAt,
    ...(attachments.length > 0
      ? {
          attachment_urls:
            attachments,
        }
      : {}),
  };
}

function nextCollectionPage(
  html: string,
  baseUrl: string,
): string | undefined {
  const candidate = extractLinks(
    html,
    baseUrl,
  ).find(
    (link) =>
      /^next(?:\s|$|›|»)/i.test(
        link.text,
      ) ||
      link.text === "›" ||
      link.text === "»",
  );

  if (!candidate) return undefined;

  try {
    const url = new URL(
      candidate.href,
    );

    return ALLOWED_HOSTS.includes(
      url.hostname as (typeof ALLOWED_HOSTS)[number],
    )
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function collectOge(
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
      : [...DEFAULT_START_URLS];
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
    const seen =
      new Set<string>();

    for (
      let page = 0;
      current &&
      page < maxPages &&
      discovered.size < maxItems;
      page += 1
    ) {
      if (seen.has(current)) break;
      seen.add(current);

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
          discoverOgeLegalAdvisories(
            response.body,
            response.finalUrl,
          )) {
          if (
            discovered.size >= maxItems
          ) {
            break;
          }

          if (
            !discovered.has(item.url)
          ) {
            discovered.set(
              item.url,
              item,
            );
          }
        }

        current =
          nextCollectionPage(
            response.body,
            response.finalUrl,
          );
      } catch (error) {
        warnings.push({
          code:
            "collection_fetch_failed",
          message:
            error instanceof Error
              ? error.message
              : "Unknown collection fetch error.",
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
        parseOgeLegalAdvisory(
          response.body,
          response.finalUrl,
          retrievedAt,
          item,
        ),
      );
    } catch (error) {
      warnings.push({
        code:
          "advisory_fetch_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unknown advisory fetch error.",
        url: item.url,
      });
    }
  }

  if (rows.length === 0) {
    warnings.push({
      code: "no_items_discovered",
      message:
        "No OGE Legal Advisory resource pages were discovered. OGE's Legal Research Collection may render results client-side; supply one or more --start-url values pointing to OGE Legal Advisory resource pages or server-rendered advisory indexes when needed.",
    });
  }

  return {
    rows,
    sourcePages,
    warnings,
  };
}

export const ogeLegalAdvisoriesAdapter:
  SourceAdapter = {
    id: "oge-legal-advisories",
    label:
      "U.S. Office of Government Ethics Legal Advisories",
    allowedHosts: ALLOWED_HOSTS,
    defaultStartUrls:
      DEFAULT_START_URLS,
    collect: collectOge,
  };
