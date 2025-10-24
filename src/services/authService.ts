import { randomBytes } from "crypto";
import type { Request } from "express";

export interface Session {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export const SESSION_COOKIE_NAME = "cygnus_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const generateToken = (): string => randomBytes(32).toString("base64url");

export const createSession = (email: string): Session => {
  const now = Date.now();
  const token = generateToken();
  const session: Session = {
    token,
    email,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(token, session);
  return session;
};

export const getSession = (token: string): Session | null => {
  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  // Refresh expiry on activity to keep the session alive.
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
};

export const deleteSession = (token: string): void => {
  sessions.delete(token);
};

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader || cookieHeader.length === 0) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, rawPair) => {
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

export const purgeExpiredSessions = (): void => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
};
