import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE = "civic_registry_admin";
const SESSION_SECONDS = 8 * 60 * 60;

export interface AdminSession {
  actorId: string;
  roles: string[];
  expiresAt: number;
}

function configuredToken(): string {
  return (
    process.env.CIVIC_REGISTRY_ADMIN_TOKEN ?? ""
  ).trim();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function signature(
  payload: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function normalizeRoles(roles: string[]): string[] {
  return [
    ...new Set(
      roles
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ];
}

export function adminConsoleConfigured(): boolean {
  return configuredToken().length > 0;
}

export function verifyAdminAccessToken(
  suppliedToken: string,
): boolean {
  const expected = configuredToken();

  if (!expected || !suppliedToken) return false;

  return timingSafeEqual(
    digest(suppliedToken),
    digest(expected),
  );
}

export async function establishAdminSession(
  actorId: string,
  roles: string[],
): Promise<void> {
  const secret = configuredToken();

  if (!secret) {
    throw new Error(
      "The administrator console is disabled because CIVIC_REGISTRY_ADMIN_TOKEN is not configured.",
    );
  }

  const normalizedActor = actorId.trim();

  if (!normalizedActor) {
    throw new Error("An administrator actor ID is required.");
  }

  const session: AdminSession = {
    actorId: normalizedActor,
    roles: normalizeRoles(roles),
    expiresAt:
      Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const payload = Buffer.from(
    JSON.stringify(session),
  ).toString("base64url");
  const value =
    payload + "." + signature(payload, secret);
  const store = await cookies();

  store.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const secret = configuredToken();

  if (!secret) return null;

  const value = (await cookies()).get(
    ADMIN_COOKIE,
  )?.value;

  if (!value) return null;

  const [payload, suppliedSignature] =
    value.split(".");

  if (!payload || !suppliedSignature) return null;

  const expectedSignature = signature(
    payload,
    secret,
  );

  const suppliedDigest = digest(
    suppliedSignature,
  );
  const expectedDigest = digest(
    expectedSignature,
  );

  if (
    !timingSafeEqual(
      suppliedDigest,
      expectedDigest,
    )
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString(
        "utf8",
      ),
    ) as Partial<AdminSession>;

    if (
      typeof parsed.actorId !== "string" ||
      !Array.isArray(parsed.roles) ||
      !parsed.roles.every(
        (role) => typeof role === "string",
      ) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <=
        Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      actorId: parsed.actorId,
      roles: normalizeRoles(parsed.roles),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/sign-in");
  }

  return session;
}
