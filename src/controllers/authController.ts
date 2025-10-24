import { type Request, type Response } from "express";
import type { CookieOptions } from "express";
import type { Logger } from "pino";

import logger from "../logger";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  getSessionFromRequest,
} from "../services/authService";

type LoggedRequest = Request & { log?: Logger };

const getRequestLogger = (req: Request): Logger => {
  const request = req as LoggedRequest;
  return request.log ?? logger;
};

const EMAIL_ENV_KEY = "BGH_EMAIL";
const PASSWORD_ENV_KEY = "BGH_PASSWORD";

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_MS,
};

const normaliseString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const login = (req: Request, res: Response): void => {
  const log = getRequestLogger(req).child({ route: "authLogin" });
  const email = normaliseString(req.body?.email);
  const password = normaliseString(req.body?.password);

  if (!email || !password) {
    log.warn({ hasEmail: Boolean(email), hasPassword: Boolean(password) }, "Missing credentials in request");
    res.status(400).json({
      code: "INVALID_BODY",
      message: "Debés enviar email y contraseña válidos.",
    });
    return;
  }

  const configuredEmail = normaliseString(process.env[EMAIL_ENV_KEY]);
  const configuredPassword = normaliseString(process.env[PASSWORD_ENV_KEY]);

  if (!configuredEmail || !configuredPassword) {
    log.error("Missing backend credentials configuration");
    res.status(500).json({
      code: "CONFIGURATION_ERROR",
      message: "El servicio no está configurado para autenticación.",
    });
    return;
  }

  if (
    configuredEmail.toLowerCase() !== email.toLowerCase() ||
    configuredPassword !== password
  ) {
    log.warn({ email }, "Invalid credentials provided");
    res.status(401).json({
      code: "INVALID_CREDENTIALS",
      message: "Email o contraseña incorrectos.",
    });
    return;
  }

  const session = createSession(configuredEmail);
  res.cookie(SESSION_COOKIE_NAME, session.token, COOKIE_OPTIONS);
  log.info({ email }, "User authenticated");
  res.json({
    user: {
      email: configuredEmail,
    },
  });
};

export const logout = (req: Request, res: Response): void => {
  const log = getRequestLogger(req).child({ route: "authLogout" });
  const session = getSessionFromRequest(req);
  if (session) {
    deleteSession(session.token);
    log.info({ email: session.email }, "Session terminated");
  }

  res.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
  res.status(204).end();
};

export const currentUser = (req: Request, res: Response): void => {
  const log = getRequestLogger(req).child({ route: "authCurrentUser" });
  const session = getSessionFromRequest(req);
  if (!session) {
    log.debug("No active session found");
    res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "No hay una sesión activa.",
    });
    return;
  }

  log.debug({ email: session.email }, "Returning authenticated user");
  res.json({
    user: {
      email: session.email,
    },
  });
};
