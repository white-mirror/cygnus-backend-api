import "dotenv/config";
import { randomUUID } from "crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import logger from "./logger";
import bghRoutes from "../app/routes/bghRoutes";
import authRoutes from "../app/routes/authRoutes";

type LoggedRequest = Request & { log: Logger };

const rawAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? "";
const allowedOrigins = rawAllowedOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const vercelOriginPattern = /^https?:\/\/[a-z0-9-]+\.vercel\.app$/i;
const defaultAllowedOrigins: Array<string | RegExp> = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
  "capacitor://localhost",
  vercelOriginPattern,
];

const isOriginPermitted = (origin: string | undefined): boolean => {
  if (!origin) {
    return true;
  }
  if (
    allowedOrigins.some(
      (allowedOrigin) => allowedOrigin.length > 0 && allowedOrigin === origin,
    )
  ) {
    return true;
  }
  return defaultAllowedOrigins.some((allowedOrigin) => {
    if (typeof allowedOrigin === "string") {
      return allowedOrigin === origin;
    }
    return allowedOrigin.test(origin);
  });
};

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginPermitted(origin ?? undefined)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin ?? "<unknown>"}`));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

const corsMiddleware = cors(corsOptions);

export const createApp = (): express.Express => {
  const app = express();

  logger.info(
    {
      allowedOrigins,
      defaultAllowedOrigins: defaultAllowedOrigins.map((item) =>
        typeof item === "string" ? item : item.toString(),
      ),
    },
    "Configured CORS",
  );

  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === "/api/ping",
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
          };
        },
        res(response) {
          return {
            statusCode: response.statusCode,
          };
        },
        err(error: unknown) {
          return error;
        },
      },
    }),
  );

  app.use(corsMiddleware);
  app.options(/.*/, corsMiddleware);
  app.use(express.json());

  app.use("/api/auth", authRoutes);
  app.use("/api/bgh", bghRoutes);

  app.get("/api/ping", (req: Request, res: Response) => {
    const request = req as LoggedRequest;
    request.log.debug("Received ping request");
    res.json({ message: "pong desde backend :)" });
  });

  app.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      const request = req as LoggedRequest;
      request.log.error({ err: error }, "Unhandled error");
      res.status(500).json({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
      });
    },
  );

  return app;
};

const app = createApp();

export default app;
