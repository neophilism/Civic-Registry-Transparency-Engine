import type {
  SourceRefreshJobDefinition,
} from "@civic-registry/database";

export const openLegalInterpretationsRefreshJobs:
  SourceRefreshJobDefinition[] = [
    {
      id: "doj-olc-daily",
      registryId:
        "open-legal-interpretations",
      label:
        "DOJ Office of Legal Counsel opinions",
      adapterId: "doj-olc",
      profileId:
        "open-legal-interpretations-public-source-adapter",
      enabled: true,
      intervalSeconds: 86_400,
      staleAfterSeconds: 259_200,
      failureBackoffBaseSeconds: 900,
      failureBackoffMaxSeconds: 21_600,
      emptyResultBehavior: "failure",
      rowCountDropWarningPercent: 50,
      adapterOptions: {
        maxItems: 100,
        maxPages: 5,
      },
    },
    {
      id: "oge-legal-advisories-daily",
      registryId:
        "open-legal-interpretations",
      label:
        "U.S. Office of Government Ethics Legal Advisories",
      adapterId:
        "oge-legal-advisories",
      profileId:
        "open-legal-interpretations-public-source-adapter",
      enabled: true,
      intervalSeconds: 86_400,
      staleAfterSeconds: 259_200,
      failureBackoffBaseSeconds: 900,
      failureBackoffMaxSeconds: 21_600,
      emptyResultBehavior: "warning",
      rowCountDropWarningPercent: 50,
      adapterOptions: {
        maxItems: 100,
        maxPages: 5,
      },
    },
  ];
