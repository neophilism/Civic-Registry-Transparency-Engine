import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  posix,
} from "node:path";

import type {
  DocumentStorage,
  StoredDocument,
} from "./types.ts";

function safeHash(value: string): string {
  const normalized =
    value.trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(
      "Document SHA-256 must contain exactly 64 hexadecimal characters.",
    );
  }

  return normalized;
}

function safeExtension(
  value: string,
): string {
  const normalized =
    value
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "");

  if (
    !normalized ||
    !/^[a-z0-9]{1,12}$/.test(
      normalized,
    )
  ) {
    throw new Error(
      "Document extension must contain 1-12 lowercase alphanumeric characters.",
    );
  }

  return normalized;
}

export class FileSystemDocumentStorage
  implements DocumentStorage
{
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    const root = rootDirectory.trim();

    if (!root) {
      throw new Error(
        "Document storage root directory is required.",
      );
    }

    this.rootDirectory = root;
  }

  async put(input: {
    sha256: string;
    extension: string;
    data: Uint8Array;
  }): Promise<StoredDocument> {
    const sha256 = safeHash(
      input.sha256,
    );
    const extension =
      safeExtension(
        input.extension,
      );
    const storageKey =
      posix.join(
        "sha256",
        sha256.slice(0, 2),
        sha256 +
          "." +
          extension,
      );
    const absolutePath =
      join(
        this.rootDirectory,
        ...storageKey.split("/"),
      );

    await mkdir(
      dirname(absolutePath),
      {
        recursive: true,
      },
    );

    try {
      await writeFile(
        absolutePath,
        input.data,
        {
          flag: "wx",
        },
      );
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "EEXIST"
        )
      ) {
        throw error;
      }
    }

    return {
      storageKey,
      byteLength:
        input.data.byteLength,
    };
  }
}
