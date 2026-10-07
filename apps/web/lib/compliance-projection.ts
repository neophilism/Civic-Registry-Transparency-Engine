export interface RegistryComplianceProjection {
  organizationId: string;
  resource: {
    id: string;
    resourceType: string;
    name: string;
    externalRef: string | null;
    status:
      | "active"
      | "inactive"
      | "archived";
  };
  latestCheck: {
    id: string;
    status: string;
    evaluatedAt: string | null;
    ruleSetId: string | null;
    ruleSetVersion: string | null;
    registeredRuleSetId: string | null;
    ruleSetHash: string | null;
    registrationMode: string | null;
  } | null;
  certifications: {
    validCount: number;
    activeCertificateNumbers: string[];
  };
  findings: {
    unresolvedCount: number;
    unresolvedHighCriticalCount: number;
  };
}

export type ComplianceProjectionResult =
  | {
      status: "available";
      projection:
        RegistryComplianceProjection;
    }
  | {
      status: "not_configured";
    }
  | {
      status: "unavailable";
      reason: string;
    };

export interface ComplianceProjectionClientOptions {
  baseUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function normalizeBaseUrl(
  value: string,
): string {
  const url = new URL(value);

  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (
        url.hostname ===
          "localhost" ||
        url.hostname ===
          "127.0.0.1" ||
        url.hostname === "::1"
      )
    )
  ) {
    throw new Error(
      "Compliance Engine base URL must use HTTPS except for local development.",
    );
  }

  return url.toString().replace(
    /\/$/,
    "",
  );
}

function errorReason(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Compliance projection request failed.";
}

export async function fetchComplianceRegistryProjection(
  resourceId: string,
  options:
    ComplianceProjectionClientOptions,
): Promise<RegistryComplianceProjection> {
  const normalizedResourceId =
    resourceId.trim();

  if (!normalizedResourceId) {
    throw new Error(
      "Compliance resource ID must be non-empty.",
    );
  }

  const token =
    options.serviceToken.trim();

  if (!token.startsWith("caiae_")) {
    throw new Error(
      "Compliance projection requires a Compliance Engine service token.",
    );
  }

  const baseUrl =
    normalizeBaseUrl(
      options.baseUrl,
    );
  const fetchImpl =
    options.fetchImpl ??
    globalThis.fetch;

  if (!fetchImpl) {
    throw new Error(
      "A fetch implementation is required.",
    );
  }

  const controller =
    new AbortController();
  const timeout =
    setTimeout(
      () => controller.abort(),
      Math.max(
        100,
        Math.min(
          options.timeoutMs ??
            5000,
          30000,
        ),
      ),
    );

  try {
    const response =
      await fetchImpl(
        baseUrl +
          "/v1/integration/resources/" +
          encodeURIComponent(
            normalizedResourceId,
          ) +
          "/registry-projection",
        {
          method: "GET",
          headers: {
            accept:
              "application/json",
            authorization:
              "Bearer " +
              token,
          },
          cache: "no-store",
          signal:
            controller.signal,
        },
      );

    if (!response.ok) {
      throw new Error(
        "Compliance Engine returned HTTP " +
          response.status +
          ".",
      );
    }

    return (
      await response.json()
    ) as RegistryComplianceProjection;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getConfiguredComplianceProjection(
  resourceId: string,
): Promise<ComplianceProjectionResult> {
  const baseUrl =
    process.env
      .CIVIC_COMPLIANCE_API_BASE_URL;
  const serviceToken =
    process.env
      .CIVIC_COMPLIANCE_SERVICE_TOKEN;

  if (
    !baseUrl?.trim() ||
    !serviceToken?.trim()
  ) {
    return {
      status: "not_configured",
    };
  }

  try {
    return {
      status: "available",
      projection:
        await fetchComplianceRegistryProjection(
          resourceId,
          {
            baseUrl,
            serviceToken,
          },
        ),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason:
        errorReason(error),
    };
  }
}
