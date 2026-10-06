import {
  PUBLIC_API_VERSION,
} from "./types.ts";

type JsonObject = {
  [key: string]: unknown;
};

const registryIdParameter = {
  name: "registryId",
  in: "path",
  required: true,
  schema: {
    type: "string",
  },
} as const;

const recordIdParameter = {
  name: "recordId",
  in: "path",
  required: true,
  schema: {
    type: "string",
  },
} as const;

const searchParameters = [
  {
    name: "q",
    in: "query",
    schema: { type: "string" },
    description: "Full-text query.",
  },
  {
    name: "type",
    in: "query",
    schema: { type: "string" },
    description: "Record type id.",
  },
  {
    name: "status",
    in: "query",
    schema: {
      type: "array",
      items: { type: "string" },
    },
    style: "form",
    explode: true,
  },
  {
    name: "tag",
    in: "query",
    schema: {
      type: "array",
      items: { type: "string" },
    },
    style: "form",
    explode: true,
  },
  {
    name: "sort",
    in: "query",
    schema: { type: "string" },
  },
  {
    name: "order",
    in: "query",
    schema: {
      type: "string",
      enum: ["asc", "desc"],
    },
  },
  {
    name: "page",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
    },
  },
  {
    name: "pageSize",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 100,
    },
  },
] as const;

function jsonResponse(
  schema: JsonObject,
  description = "Successful response.",
): JsonObject {
  return {
    description,
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

function envelopeSchema(
  dataSchema: JsonObject,
): JsonObject {
  return {
    type: "object",
    required: ["apiVersion", "data"],
    properties: {
      apiVersion: {
        type: "string",
        const: PUBLIC_API_VERSION,
      },
      data: dataSchema,
    },
  };
}

function publicGet(
  summary: string,
  options: {
    parameters?: readonly unknown[];
    dataSchema?: JsonObject;
  } = {},
): JsonObject {
  return {
    summary,
    parameters: options.parameters ?? [],
    responses: {
      "200": jsonResponse(
        envelopeSchema(
          options.dataSchema ?? {
            type: "object",
          },
        ),
      ),
      "400": {
        $ref: "#/components/responses/BadRequest",
      },
      "404": {
        $ref: "#/components/responses/NotFound",
      },
    },
  };
}

export function buildPublicApiOpenApiDocument(
  options: {
    title?: string;
    description?: string;
  } = {},
): JsonObject {
  return {
    openapi: "3.1.0",
    info: {
      title:
        options.title ??
        "Civic Registry & Transparency Engine Public API",
      version: PUBLIC_API_VERSION,
      description:
        options.description ??
        "Read-only, disclosure-safe public registry API.",
    },
    servers: [
      {
        url: "/api/v1",
      },
    ],
    tags: [
      { name: "Registries" },
      { name: "Records" },
      { name: "Evidence" },
      { name: "Relationships" },
      { name: "History" },
      { name: "Deadlines" },
      { name: "Exports" },
    ],
    paths: {
      "/registries": {
        get: {
          ...publicGet(
            "List installed public registries.",
            {
              dataSchema: {
                type: "array",
                items: {
                  $ref:
                    "#/components/schemas/RegistrySummary",
                },
              },
            },
          ),
          tags: ["Registries"],
        },
      },
      "/registries/{registryId}": {
        get: {
          ...publicGet(
            "Get public registry metadata.",
            {
              parameters: [
                registryIdParameter,
              ],
            },
          ),
          tags: ["Registries"],
        },
      },
      "/registries/{registryId}/records": {
        get: {
          ...publicGet(
            "List/search public records.",
            {
              parameters: [
                registryIdParameter,
                ...searchParameters,
              ],
            },
          ),
          tags: ["Records"],
        },
      },
      "/registries/{registryId}/search": {
        get: {
          ...publicGet(
            "Search public records.",
            {
              parameters: [
                registryIdParameter,
                ...searchParameters,
              ],
            },
          ),
          tags: ["Records"],
        },
      },
      "/registries/{registryId}/records/{recordId}": {
        get: {
          ...publicGet(
            "Get one disclosure-safe public record.",
            {
              parameters: [
                registryIdParameter,
                recordIdParameter,
              ],
            },
          ),
          tags: ["Records"],
        },
      },
      "/registries/{registryId}/records/{recordId}/evidence":
        {
          get: {
            ...publicGet(
              "Get public evidence and citations for a record.",
              {
                parameters: [
                  registryIdParameter,
                  recordIdParameter,
                ],
              },
            ),
            tags: ["Evidence"],
          },
        },
      "/registries/{registryId}/records/{recordId}/history":
        {
          get: {
            ...publicGet(
              "Get public immutable history for a record.",
              {
                parameters: [
                  registryIdParameter,
                  recordIdParameter,
                ],
              },
            ),
            tags: ["History"],
          },
        },
      "/registries/{registryId}/records/{recordId}/relationships":
        {
          get: {
            ...publicGet(
              "Get public direct relationships for a record.",
              {
                parameters: [
                  registryIdParameter,
                  recordIdParameter,
                  {
                    name: "type",
                    in: "query",
                    schema: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    style: "form",
                    explode: true,
                  },
                  {
                    name: "direction",
                    in: "query",
                    schema: {
                      type: "string",
                      enum: [
                        "outbound",
                        "inbound",
                        "undirected",
                      ],
                    },
                  },
                ],
              },
            ),
            tags: ["Relationships"],
          },
        },
      "/registries/{registryId}/records/{recordId}/graph":
        {
          get: {
            ...publicGet(
              "Get a disclosure-safe public relationship graph.",
              {
                parameters: [
                  registryIdParameter,
                  recordIdParameter,
                  {
                    name: "depth",
                    in: "query",
                    schema: {
                      type: "integer",
                      minimum: 1,
                      maximum: 3,
                    },
                  },
                  {
                    name: "type",
                    in: "query",
                    schema: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    style: "form",
                    explode: true,
                  },
                ],
              },
            ),
            tags: ["Relationships"],
          },
        },
      "/registries/{registryId}/records/{recordId}/deadlines":
        {
          get: {
            ...publicGet(
              "Get publicly visible deadlines for a record.",
              {
                parameters: [
                  registryIdParameter,
                  recordIdParameter,
                ],
              },
            ),
            tags: ["Deadlines"],
          },
        },
      "/registries/{registryId}/export": {
        get: {
          summary:
            "Export the requested public record result set.",
          tags: ["Exports"],
          parameters: [
            registryIdParameter,
            ...searchParameters,
            {
              name: "format",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "json",
                  "ndjson",
                  "csv",
                ],
                default: "json",
              },
            },
            {
              name: "maxRecords",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 10000,
                default: 10000,
              },
              description:
                "Safety cap for one export request.",
            },
          ],
          responses: {
            "200": {
              description:
                "JSON, NDJSON, or CSV export.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                  },
                },
                "application/x-ndjson": {
                  schema: {
                    type: "string",
                  },
                },
                "text/csv": {
                  schema: {
                    type: "string",
                  },
                },
              },
            },
            "400": {
              $ref:
                "#/components/responses/BadRequest",
            },
            "404": {
              $ref:
                "#/components/responses/NotFound",
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary:
            "Get the OpenAPI 3.1 document.",
          responses: {
            "200": jsonResponse({
              type: "object",
            }),
          },
        },
      },
    },
    components: {
      schemas: {
        RegistrySummary: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: {
              type: "string",
            },
            defaultRecordTypeId: {
              type: "string",
            },
          },
        },
        RegistryRecord: {
          type: "object",
          required: [
            "id",
            "registryId",
            "recordTypeId",
            "fields",
            "status",
            "visibility",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            id: { type: "string" },
            registryId: {
              type: "string",
            },
            recordTypeId: {
              type: "string",
            },
            fields: {
              type: "object",
              additionalProperties: true,
            },
            status: { type: "string" },
            visibility: {
              type: "string",
              enum: ["public"],
            },
            tags: {
              type: "array",
              items: {
                type: "string",
              },
            },
            externalIdentifiers: {
              type: "array",
              items: {
                type: "object",
              },
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
            publishedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        ApiError: {
          type: "object",
          required: [
            "apiVersion",
            "error",
          ],
          properties: {
            apiVersion: {
              type: "string",
              const: PUBLIC_API_VERSION,
            },
            error: {
              type: "object",
              required: [
                "code",
                "message",
              ],
              properties: {
                code: {
                  type: "string",
                },
                message: {
                  type: "string",
                },
                issues: {
                  type: "array",
                  items: {
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Invalid request.",
          content: {
            "application/json": {
              schema: {
                $ref:
                  "#/components/schemas/ApiError",
              },
            },
          },
        },
        NotFound: {
          description:
            "Registry or record not found.",
          content: {
            "application/json": {
              schema: {
                $ref:
                  "#/components/schemas/ApiError",
              },
            },
          },
        },
      },
    },
  };
}
