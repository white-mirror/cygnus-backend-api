import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import type { Request } from "express";

export interface Session {
  token: string;
  email: string;
  password: string;
  createdAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = "cygnus_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const SESSION_SECRET_ENV = "SESSION_SECRET";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

type SessionClaims = {
  email: string;
  password: string;
  iat: number;
  exp: number;
};

const toBase64Url = (value: Buffer): string =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
};

const deriveKey = (): Buffer => {
  const secret = process.env[SESSION_SECRET_ENV];
  if (!secret || secret.length === 0) {
    throw new Error(
      `Missing ${SESSION_SECRET_ENV}. Define it to issue session tokens.`,
    );
  }
  const hash = createHash("sha256").update(secret).digest();
  return hash.subarray(0, KEY_LENGTH);
};

const encodeClaims = (claims: SessionClaims): string => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const payload = Buffer.from(JSON.stringify(claims), "utf8");
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}.${toBase64Url(authTag)}`;
};

const decodeClaims = (token: string): SessionClaims | null => {
  const [ivPart, cipherPart, tagPart] = token.split(".");
  if (!ivPart || !cipherPart || !tagPart) {
    return null;
  }

  try {
    const iv = fromBase64Url(ivPart);
    const ciphertext = fromBase64Url(cipherPart);
    const authTag = fromBase64Url(tagPart);
    const decipher = createDecipheriv(ALGORITHM, deriveKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const claims = JSON.parse(plaintext.toString("utf8")) as SessionClaims;

    if (
      !claims ||
      typeof claims.email !== "string" ||
      typeof claims.password !== "string" ||
      typeof claims.iat !== "number" ||
      typeof claims.exp !== "number"
    ) {
      return null;
    }

    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
};

export const createSession = (email: string, password: string): Session => {
  const now = Date.now();
  const claims: SessionClaims = {
    email,
    password,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const token = encodeClaims(claims);

  return {
    token,
    email,
    password,
    createdAt: claims.iat,
    expiresAt: claims.exp,
  };
};

export const getSession = (token: string): Session | null => {
  const claims = decodeClaims(token);
  if (!claims) {
    return null;
  }

  return {
    token,
    email: claims.email,
    password: claims.password,
    createdAt: claims.iat,
    expiresAt: claims.exp,
  };
};

// Stateless token: nothing to revoke server-side, but kept for API parity.
export const deleteSession = (_token: string): void => {};

const parseCookies = (
  cookieHeader: string | undefined,
): Record<string, string> => {
  if (!cookieHeader || cookieHeader.length === 0) {
    return {};
  }

  return cookieHeader
    .split(";")
    .reduce<Record<string, string>>((acc, rawPair) => {
      const [rawName, ...rest] = rawPair.split("=");
      if (!rawName) {
        return acc;
      }
      const name = rawName.trim();
      if (!name) {
        return acc;
      }
      acc[name] = rest.join("=").trim();
      return acc;
    }, {});
};

export const getSessionFromRequest = (req: Request): Session | null => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, tokenCandidate] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && tokenCandidate) {
      const session = getSession(tokenCandidate);
      if (session) {
        return session;
      }
    }
  }

  const queryTokenRaw = (req.query?.token ?? null) as string | string[] | null;
  const queryToken = Array.isArray(queryTokenRaw)
    ? queryTokenRaw[0]
    : queryTokenRaw;
  if (typeof queryToken === "string" && queryToken.length > 0) {
    const session = getSession(queryToken);
    if (session) {
      return session;
    }
  }

  const header = req.headers.cookie;
  if (!header) {
    return null;
  }

  const cookies = parseCookies(header);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  return getSession(token);
};
