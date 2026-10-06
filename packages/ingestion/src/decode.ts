import {
  sha256Fingerprint,
} from "./fingerprint.ts";
import type {
  DecodeIngestionResult,
  DecodedIngestionRow,
  IngestionFormat,
  IngestionIssue,
} from "./types.ts";

function isObjectRow(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function decodedRow(
  index: number,
  value: Record<string, unknown>,
  line?: number,
): DecodedIngestionRow {
  return {
    index,
    line,
    value,
    fingerprint: sha256Fingerprint(value),
  };
}

function decodeJson(
  input: string,
): DecodeIngestionResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return {
      rows: [],
      issues: [
        {
          code: "json_parse_error",
          message:
            error instanceof Error
              ? error.message
              : "Invalid JSON input.",
        },
      ],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      rows: [],
      issues: [
        {
          code: "json_root_not_array",
          message:
            "JSON ingestion input must be an array of objects.",
        },
      ],
    };
  }

  const rows: DecodedIngestionRow[] = [];
  const issues: IngestionIssue[] = [];

  parsed.forEach((value, index) => {
    if (!isObjectRow(value)) {
      issues.push({
        code: "row_not_object",
        message:
          "Each JSON ingestion row must be an object.",
        index,
      });
      return;
    }

    rows.push(decodedRow(index, value));
  });

  return { rows, issues };
}

function decodeNdjson(
  input: string,
): DecodeIngestionResult {
  const rows: DecodedIngestionRow[] = [];
  const issues: IngestionIssue[] = [];
  let index = 0;

  input.split(/\r?\n/).forEach((line, lineIndex) => {
    if (!line.trim()) return;

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      issues.push({
        code: "ndjson_parse_error",
        message:
          error instanceof Error
            ? error.message
            : "Invalid NDJSON row.",
        index,
        line: lineIndex + 1,
      });
      index += 1;
      return;
    }

    if (!isObjectRow(parsed)) {
      issues.push({
        code: "row_not_object",
        message:
          "Each NDJSON ingestion row must be an object.",
        index,
        line: lineIndex + 1,
      });
      index += 1;
      return;
    }

    rows.push(
      decodedRow(
        index,
        parsed,
        lineIndex + 1,
      ),
    );
    index += 1;
  });

  return { rows, issues };
}

interface CsvRow {
  cells: string[];
  line: number;
}

function parseCsv(
  input: string,
  delimiter: string,
): {
  rows: CsvRow[];
  issue?: IngestionIssue;
} {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const finishRow = () => {
    cells.push(cell);
    const blank =
      cells.length === 1 &&
      cells[0].trim().length === 0;

    if (!blank) {
      rows.push({
        cells,
        line: rowLine,
      });
    }

    cells = [];
    cell = "";
    rowLine = line;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      if (character === "\r") {
        if (input[index + 1] === "\n") {
          index += 1;
        }
        cell += "\n";
        line += 1;
        continue;
      }

      if (character === "\n") {
        cell += "\n";
        line += 1;
        continue;
      }

      cell += character;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      cells.push(cell);
      cell = "";
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (
        character === "\r" &&
        input[index + 1] === "\n"
      ) {
        index += 1;
      }

      finishRow();
      line += 1;
      rowLine = line;
      continue;
    }

    cell += character;
  }

  if (inQuotes) {
    return {
      rows: [],
      issue: {
        code: "csv_unclosed_quote",
        message:
          "CSV input ended inside a quoted field.",
        line: rowLine,
      },
    };
  }

  if (cell.length > 0 || cells.length > 0) {
    finishRow();
  }

  return { rows };
}

function decodeCsv(
  input: string,
  delimiter: string,
): DecodeIngestionResult {
  if (delimiter.length !== 1) {
    return {
      rows: [],
      issues: [
        {
          code: "invalid_csv_delimiter",
          message:
            "CSV delimiter must be exactly one character.",
        },
      ],
    };
  }

  const parsed = parseCsv(input, delimiter);

  if (parsed.issue) {
    return {
      rows: [],
      issues: [parsed.issue],
    };
  }

  if (parsed.rows.length === 0) {
    return {
      rows: [],
      issues: [],
    };
  }

  const header = parsed.rows[0];
  const headers = header.cells.map((value) =>
    value.trim(),
  );
  const issues: IngestionIssue[] = [];

  if (headers.some((value) => !value)) {
    issues.push({
      code: "csv_empty_header",
      message:
        "CSV header names must be non-empty.",
      line: header.line,
    });
  }

  if (new Set(headers).size !== headers.length) {
    issues.push({
      code: "csv_duplicate_header",
      message:
        "CSV header names must be unique.",
      line: header.line,
    });
  }

  if (issues.length > 0) {
    return {
      rows: [],
      issues,
    };
  }

  const rows: DecodedIngestionRow[] = [];

  parsed.rows.slice(1).forEach((row, index) => {
    if (row.cells.length !== headers.length) {
      issues.push({
        code: "csv_column_count_mismatch",
        message:
          `CSV row has ${row.cells.length} columns; expected ${headers.length}.`,
        index,
        line: row.line,
      });
      return;
    }

    const value = Object.fromEntries(
      headers.map((headerName, column) => [
        headerName,
        row.cells[column],
      ]),
    );

    rows.push(
      decodedRow(index, value, row.line),
    );
  });

  return { rows, issues };
}

export function decodeIngestionInput(
  input: string,
  format: IngestionFormat,
  options: {
    csvDelimiter?: string;
  } = {},
): DecodeIngestionResult {
  if (format === "json") {
    return decodeJson(input);
  }

  if (format === "ndjson") {
    return decodeNdjson(input);
  }

  return decodeCsv(
    input,
    options.csvDelimiter ?? ",",
  );
}
