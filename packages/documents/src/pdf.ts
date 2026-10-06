import {
  createHash,
} from "node:crypto";

import {
  getDocument,
  version,
} from "pdfjs-dist/legacy/build/pdf.mjs";

import type {
  ExtractedDocumentPage,
  PdfExtraction,
} from "./types.ts";

function sha256(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function normalizePageText(
  items: Array<unknown>,
): string {
  let output = "";

  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      !("str" in item) ||
      typeof item.str !== "string"
    ) {
      continue;
    }

    const text =
      item.str
        .replace(/\s+/g, " ")
        .trim();

    if (text) {
      if (
        output &&
        !/[\s\n]$/.test(output)
      ) {
        output += " ";
      }

      output += text;
    }

    if (
      "hasEOL" in item &&
      item.hasEOL === true
    ) {
      output += "\n";
    }
  }

  return output
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(
  data: Uint8Array,
): Promise<PdfExtraction> {
  if (data.byteLength < 5) {
    throw new Error(
      "PDF attachment is empty or too small.",
    );
  }

  const header =
    new TextDecoder("ascii")
      .decode(data.slice(0, 5));

  if (header !== "%PDF-") {
    throw new Error(
      "Attachment does not have a PDF file signature.",
    );
  }

  const loadingTask =
    getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
    });
  const pages:
    ExtractedDocumentPage[] = [];
  const warnings: string[] = [];

  try {
    const document =
      await loadingTask.promise;

    for (
      let pageNumber = 1;
      pageNumber <=
        document.numPages;
      pageNumber += 1
    ) {
      const page =
        await document.getPage(
          pageNumber,
        );

      try {
        const content =
          await page.getTextContent();
        const text =
          normalizePageText(
            content.items,
          );

        if (!text) {
          warnings.push(
            "Page " +
              pageNumber +
              " contains no extractable text.",
          );
        }

        pages.push({
          page: pageNumber,
          text,
        });
      } finally {
        page.cleanup();
      }
    }

    const text =
      pages
        .map((page) => page.text)
        .filter(Boolean)
        .join("\n\n")
        .trim();

    if (!text) {
      warnings.push(
        "PDF contains no extractable text; OCR may be required.",
      );
    }

    return {
      extractor: "pdfjs",
      extractorVersion: version,
      pageCount:
        document.numPages,
      text,
      textSha256:
        sha256(text),
      pages,
      warnings,
    };
  } finally {
    await loadingTask.destroy();
  }
}
