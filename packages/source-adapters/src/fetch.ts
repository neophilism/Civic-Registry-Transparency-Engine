import {
  lookup as dnsLookup,
} from "node:dns/promises";
import { isIP } from "node:net";

import type {
  PublicSourceBinaryFetchResult,
  PublicSourceClient,
  PublicSourceClientOptions,
  PublicSourceFetchMetadata,
  PublicSourceFetchResult,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT =
  "Civic-Registry-Transparency-Engine/1.0 public-source-adapter";

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isAllowedHost(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const normalized = normalizeHost(hostname);

  return allowedHosts.some(
    (host) => normalizeHost(host) === normalized,
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255,
    )
  ) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    return isPrivateIpv4(address);
  }

  if (version === 6) {
    const value = address.toLowerCase();

    if (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value)
    ) {
      return true;
    }

    const mapped = value.match(
      /^::ffff:(\d+\.\d+\.\d+\.\d+)$/,
    );

    return mapped?.[1]
      ? isPrivateIpv4(mapped[1])
      : false;
  }

  return true;
}

function validateUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Source URL is invalid: ${rawUrl}`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `Public source URL must use HTTPS: ${url.toString()}`,
    );
  }

  if (url.username || url.password) {
    throw new Error(
      "Public source URLs cannot contain credentials.",
    );
  }

  if (!isAllowedHost(url.hostname, allowedHosts)) {
    throw new Error(
      `Public source host is not allowed for this adapter: ${url.hostname}`,
    );
  }

  return url;
}

async function readLimitedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength =
    response.headers.get("content-length");

  if (
    contentLength &&
    Number(contentLength) > maxBytes
  ) {
    throw new Error(
      `Source response exceeds configured size limit of ${maxBytes} bytes.`,
    );
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } =
        await reader.read();

      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel(
          "response too large",
        );
        throw new Error(
          `Source response exceeds configured size limit of ${maxBytes} bytes.`,
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

function metadata(
  response: Response,
  requestedUrl: string,
  current: URL,
): PublicSourceFetchMetadata {
  return {
    requestedUrl,
    finalUrl: current.toString(),
    contentType:
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "",
    fetchedAt:
      new Date().toISOString(),
    etag:
      response.headers.get("etag") ??
      undefined,
    lastModified:
      response.headers.get(
        "last-modified",
      ) ?? undefined,
  };
}

export function createPublicSourceClient(
  options: PublicSourceClientOptions = {},
): PublicSourceClient {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ??
    DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects =
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent =
    options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl =
    options.fetchImpl ?? fetch;
  const lookupImpl =
    options.dnsLookup ??
    (async (hostname: string) =>
      dnsLookup(hostname, {
        all: true,
        verbatim: true,
      }));

  async function request(
    rawUrl: string,
    allowedHosts: readonly string[],
    accept: string,
  ): Promise<{
    response: Response;
    requestedUrl: string;
    current: URL;
  }> {
    let current = validateUrl(
      rawUrl,
      allowedHosts,
    );
    let redirects = 0;
    const requestedUrl = current.toString();

    while (true) {
      const addresses =
        await lookupImpl(current.hostname);

      if (
        addresses.length === 0 ||
        addresses.some((entry) =>
          isPrivateAddress(entry.address),
        )
      ) {
        throw new Error(
          `Public source host resolves to a private, local, or reserved address: ${current.hostname}`,
        );
      }

      const response = await fetchImpl(
        current,
        {
          method: "GET",
          redirect: "manual",
          headers: {
            accept,
            "user-agent": userAgent,
          },
          signal:
            AbortSignal.timeout(
              timeoutMs,
            ),
        },
      );

      if (
        response.status >= 300 &&
        response.status < 400
      ) {
        const location =
          response.headers.get("location");

        if (!location) {
          throw new Error(
            `Source returned redirect without Location header: HTTP ${response.status}`,
          );
        }

        redirects += 1;

        if (redirects > maxRedirects) {
          throw new Error(
            `Source exceeded redirect limit of ${maxRedirects}.`,
          );
        }

        current = validateUrl(
          new URL(
            location,
            current,
          ).toString(),
          allowedHosts,
        );
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Source returned HTTP ${response.status} for ${current.toString()}.`,
        );
      }

      return {
        response,
        requestedUrl,
        current,
      };
    }
  }

  return {
    async fetchText(
      rawUrl: string,
      allowedHosts: readonly string[],
    ): Promise<PublicSourceFetchResult> {
      const {
        response,
        requestedUrl,
        current,
      } = await request(
        rawUrl,
        allowedHosts,
        "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
      );
      const meta = metadata(
        response,
        requestedUrl,
        current,
      );

      if (
        meta.contentType &&
        ![
          "text/html",
          "application/xhtml+xml",
          "text/plain",
        ].includes(meta.contentType)
      ) {
        throw new Error(
          `Unsupported source content type ${meta.contentType || "(missing)"} for ${current.toString()}.`,
        );
      }

      const bytes =
        await readLimitedBytes(
          response,
          maxResponseBytes,
        );

      return {
        ...meta,
        body:
          new TextDecoder("utf-8", {
            fatal: false,
          }).decode(bytes),
      };
    },

    async fetchBytes(
      rawUrl: string,
      allowedHosts: readonly string[],
    ): Promise<PublicSourceBinaryFetchResult> {
      const {
        response,
        requestedUrl,
        current,
      } = await request(
        rawUrl,
        allowedHosts,
        "application/pdf,application/octet-stream;q=0.8,*/*;q=0.1",
      );
      const meta = metadata(
        response,
        requestedUrl,
        current,
      );
      const body =
        await readLimitedBytes(
          response,
          maxResponseBytes,
        );

      return {
        ...meta,
        body,
      };
    },
  };
}

export const publicSourceFetchInternals = {
  isPrivateAddress,
  validateUrl,
};
