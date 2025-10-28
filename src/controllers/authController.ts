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
import {
  BGHServiceError,
  validateCredentials,
} from "../services/bghService";

type LoggedRequest = Request & { log?: Logger };

const getRequestLogger = (req: Request): Logger => {
  const request = req as LoggedRequest;
  return request.log ?? logger;
};

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? ("none" as const) : "lax",
  secure: isProduction,
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

export const login = async (req: Request, res: Response): Promise<void> => {
  const log = getRequestLogger(req).child({ route: "authLogin" });
  const email = normaliseString(req.body?.email);
  const password = normaliseString(req.body?.password);

  if (!email || !password) {
    log.warn(
      { hasEmail: Boolean(email), hasPassword: Boolean(password) },
      "Missing credentials in request",
    );
    res.status(400).json({
      code: "INVALID_BODY",
      message: "Debés enviar email y contraseña válidos.",
    });
    return;
  }

  try {
    await validateCredentials(
      { email, password },
      log.child({ phase: "validateCredentials" }),
    );
  } catch (error) {
    if (error instanceof BGHServiceError) {
      if (error.code === "AUTHENTICATION_ERROR") {
        log.warn({ email }, "Invalid credentials provided");
        res.status(401).json({
          code: "INVALID_CREDENTIALS",
          message: "Email o contraseña incorrectos.",
        });
        return;
      }

      log.error(
        { email, err: error },
        "Failed to validate credentials against BGH",
      );
      res.status(502).json({
        code: "BGH_VALIDATION_FAILED",
        message:
          "No pudimos validar tus credenciales con el servicio de BGH. Intentalo nuevamente en unos minutos.",
      });
      return;
    }

    log.error({ email, err: error }, "Unexpected validation failure");
    res.status(500).json({
      code: "AUTH_VALIDATION_ERROR",
      message: "No pudimos validar tus credenciales en este momento.",
    });
    return;
  }

  const session = createSession(email, password);
  res.cookie(SESSION_COOKIE_NAME, session.token, COOKIE_OPTIONS);
  log.info({ email }, "User authenticated");
  res.json({
    user: {
      email,
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
