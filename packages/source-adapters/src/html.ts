const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function decodeHtmlEntities(
  value: string,
): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        const code = Number.parseInt(
          entity.slice(2),
          16,
        );

        return Number.isFinite(code)
          ? String.fromCodePoint(code)
          : match;
      }

      if (entity.startsWith("#")) {
        const code = Number.parseInt(
          entity.slice(1),
          10,
        );

        return Number.isFinite(code)
          ? String.fromCodePoint(code)
          : match;
      }

      return (
        ENTITIES[entity.toLowerCase()] ??
        match
      );
    },
  );
}

export function normalizeText(
  value: string,
): string {
  return decodeHtmlEntities(
    value
      .replace(
        /<script\b[\s\S]*?<\/script>/gi,
        " ",
      )
      .replace(
        /<style\b[\s\S]*?<\/style>/gi,
        " ",
      )
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function absoluteUrl(
  href: string,
  baseUrl: string,
): string | undefined {
  try {
    return new URL(
      decodeHtmlEntities(href.trim()),
      baseUrl,
    ).toString();
  } catch {
    return undefined;
  }
}

export interface HtmlLink {
  href: string;
  text: string;
}

export function extractLinks(
  html: string,
  baseUrl: string,
): HtmlLink[] {
  const links: HtmlLink[] = [];
  const pattern =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

  for (
    let match = pattern.exec(html);
    match;
    match = pattern.exec(html)
  ) {
    const rawHref =
      match[1] ?? match[2] ?? "";
    const href = absoluteUrl(
      rawHref,
      baseUrl,
    );

    if (!href) continue;

    links.push({
      href,
      text: normalizeText(
        match[3] ?? "",
      ),
    });
  }

  return links;
}

export function extractHeadingText(
  html: string,
  level = 1,
): string | undefined {
  const pattern =
    "<h" +
    level +
    "\\b[^>]*>([\\s\\S]*?)<\\/h" +
    level +
    ">";
  const match = html.match(
    new RegExp(pattern, "i"),
  );

  return match?.[1]
    ? normalizeText(match[1])
    : undefined;
}

export function extractMetaContent(
  html: string,
  name:
    | "description"
    | "og:description",
): string | undefined {
  const escaped = name.replace(
    /[.*+?^$()|[\]\\{}]/g,
    "\\$&",
  );
  const first =
    "<meta\\b[^>]*(?:name|property)=[\"']" +
    escaped +
    "[\"'][^>]*content=[\"']([^\"']*)[\"'][^>]*>";
  const second =
    "<meta\\b[^>]*content=[\"']([^\"']*)[\"'][^>]*(?:name|property)=[\"']" +
    escaped +
    "[\"'][^>]*>";
  const patterns = [
    new RegExp(first, "i"),
    new RegExp(second, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return normalizeText(match[1]);
    }
  }

  return undefined;
}

export function extractSectionAfterHeading(
  html: string,
  heading: string,
): string | undefined {
  const headingPattern =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches = [
    ...html.matchAll(headingPattern),
  ];

  for (
    let index = 0;
    index < matches.length;
    index += 1
  ) {
    const match = matches[index];
    const text = normalizeText(
      match[2] ?? "",
    );

    if (
      text.toLowerCase() !==
      heading.trim().toLowerCase()
    ) {
      continue;
    }

    const start =
      (match.index ?? 0) +
      match[0].length;
    const end =
      matches[index + 1]?.index ??
      html.length;
    const section = normalizeText(
      html.slice(start, end),
    );

    return section || undefined;
  }

  return undefined;
}

export function stableSlug(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}


export function extractParagraphs(
  html: string,
): string[] {
  return [
    ...html.matchAll(
      /<p\b[^>]*>([\s\S]*?)<\/p>/gi,
    ),
  ]
    .map((match) =>
      normalizeText(match[1] ?? ""),
    )
    .filter(Boolean);
}
