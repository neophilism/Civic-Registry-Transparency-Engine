import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractPdfText,
  FileSystemDocumentStorage,
} from "../packages/documents/src/index.ts";
import {
  createPublicSourceClient,
} from "../packages/source-adapters/src/index.ts";
import {
  createTextPdf,
} from "./helpers/pdf-fixture.mjs";

test("PDF extraction returns page text and deterministic hashes", async () => {
  const bytes =
    createTextPdf(
      "Civic transparency opinion",
    );
  const extraction =
    await extractPdfText(bytes);

  assert.equal(
    extraction.pageCount,
    1,
  );
  assert.match(
    extraction.text,
    /Civic transparency opinion/,
  );
  assert.match(
    extraction.textSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    extraction.pages[0]?.page,
    1,
  );
  assert.match(
    extraction.pages[0]?.text ?? "",
    /Civic transparency opinion/,
  );
});

test("content-addressed filesystem storage is idempotent", async () => {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "civic-documents-",
      ),
    );

  try {
    const bytes =
      createTextPdf(
        "Stored document",
      );
    const crypto =
      await import(
        "node:crypto"
      );
    const sha256 =
      crypto
        .createHash("sha256")
        .update(bytes)
        .digest("hex");
    const storage =
      new FileSystemDocumentStorage(
        root,
      );
    const first =
      await storage.put({
        sha256,
        extension: "pdf",
        data: bytes,
      });
    const second =
      await storage.put({
        sha256,
        extension: "pdf",
        data: bytes,
      });

    assert.equal(
      first.storageKey,
      second.storageKey,
    );
    assert.equal(
      first.byteLength,
      bytes.byteLength,
    );

    const stored =
      await readFile(
        join(
          root,
          ...first.storageKey.split(
            "/",
          ),
        ),
      );

    assert.deepEqual(
      new Uint8Array(stored),
      bytes,
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

test("binary source fetch preserves safe-fetch protections and returns bytes", async () => {
  const pdf =
    createTextPdf(
      "Binary fetch",
    );
  const client =
    createPublicSourceClient({
      maxResponseBytes:
        pdf.byteLength + 10,
      dnsLookup: async () => [
        {
          address: "8.8.8.8",
          family: 4,
        },
      ],
      fetchImpl: async () =>
        new Response(pdf, {
          status: 200,
          headers: {
            "content-type":
              "application/pdf",
          },
        }),
    });

  const result =
    await client.fetchBytes(
      "https://www.justice.gov/file.pdf",
      ["www.justice.gov"],
    );

  assert.equal(
    result.contentType,
    "application/pdf",
  );
  assert.deepEqual(
    result.body,
    pdf,
  );

  await assert.rejects(
    client.fetchBytes(
      "https://attacker.example/file.pdf",
      ["www.justice.gov"],
    ),
    /not allowed/i,
  );
});
