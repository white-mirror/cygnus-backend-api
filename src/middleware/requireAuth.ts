import { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";

import logger from "../logger";
import { getSessionFromRequest } from "../services/authService";

type LoggedRequest = Request & { log?: Logger };

export interface AuthenticatedRequest extends Request {
  auth: {
    email: string;
    password: string;
    token: string;
  };
}

const getLogger = (req: Request): Logger => {
  const request = req as LoggedRequest;
  return request.log ?? logger;
};

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const session = getSessionFromRequest(req);
  if (!session) {
    const log = getLogger(req).child({ middleware: "requireAuth" });
    log.warn({ path: req.path }, "Blocked unauthenticated request");
    res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "Necesitás iniciar sesión para continuar.",
    });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    email: session.email,
    password: session.password,
    token: session.token,
  };

  next();
};
