import { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import logger from "../logger";
import {
  BGHServiceError,
  getDeviceStatus as getDeviceStatusService,
  listDevices as listDevicesService,
  listHomes as listHomesService,
  type BghServiceErrorCode,
} from "../services/bghService";
import { FAN_MODES, HVAC_MODES } from "integrations/bgh/client";
import {
  enqueueCommand,
  type CommandPayload,
} from "../services/commandQueue";
import { registerClient } from "../services/eventStream";
import type { AuthenticatedRequest } from "../middleware/requireAuth";

type LoggedRequest = Request & { log: Logger };

type Controller = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

const getRequestLogger = (req: Request): Logger => {
  const request = req as LoggedRequest;
  const baseLogger = request.log ?? logger;
  const authenticated = req as Partial<AuthenticatedRequest> & LoggedRequest;
  const userEmail = authenticated.auth?.email;

  if (userEmail) {
    return baseLogger.child({ userEmail });
  }

  return baseLogger;
};

const sendServiceError = (
  error: BGHServiceError,
  res: Response,
  log: Logger,
): void => {
  const status = mapStatus(error.code);
  log.error({ err: error, status }, "Service error response");
  res.status(status).json({
    code: error.code,
    message: error.message,
  });
};

const mapStatus = (code: BghServiceErrorCode): number => {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "AUTHENTICATION_ERROR":
      return 401;
    case "UPSTREAM_ERROR":
      return 502;
    case "CONFIGURATION_ERROR":
      return 500;
    default:
      return 500;
  }
};

const handleError = (
  error: unknown,
  log: Logger,
  res: Response,
  next: NextFunction,
): void => {
  if (error instanceof BGHServiceError) {
    sendServiceError(error, res, log);
    return;
  }
  log.error({ err: error }, "Unhandled controller error");
  next(error);
};

const parseNumericParam = (
  log: Logger,
  value: string | undefined,
  name: string,
  res: Response,
): number | null => {
  if (!value) {
    const message = `Missing required parameter '${name}'.`;
    log.warn({ param: name }, message);
    res.status(400).json({
      code: "INVALID_PARAMETER",
      message,
    });
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const message = `Parameter '${name}' must be a valid number. Received '${value}'.`;
    log.warn({ param: name, value }, message);
    res.status(400).json({
      code: "INVALID_PARAMETER",
      message,
    });
    return null;
  }
  return parsed;
};

export const listHomes: Controller = async (req, res, next) => {
  const log = getRequestLogger(req).child({ route: "listHomes" });
  log.info("Listing homes");
  try {
    const homes = await listHomesService(log);
    log.info({ homeCount: homes.length }, "Homes retrieved");
    res.json({ homes });
  } catch (error) {
    handleError(error, log, res, next);
  }
};

export const listDevices: Controller = async (req, res, next) => {
  const log = getRequestLogger(req).child({ route: "listDevices" });
  const homeId = parseNumericParam(log, req.params.homeId, "homeId", res);
  if (homeId === null) {
    return;
  }

  log.info({ homeId }, "Listing devices for home");
  try {
    const devices = await listDevicesService(homeId, log);
    log.info(
      { homeId, deviceCount: Object.keys(devices).length },
      "Devices retrieved",
    );
    res.json({ devices });
  } catch (error) {
    handleError(error, log, res, next);
  }
};

export const getDeviceStatus: Controller = async (req, res, next) => {
  const log = getRequestLogger(req).child({ route: "getDeviceStatus" });
  const homeId = parseNumericParam(log, req.params.homeId, "homeId", res);
  if (homeId === null) {
    return;
  }

  const deviceId = parseNumericParam(log, req.params.deviceId, "deviceId", res);
  if (deviceId === null) {
    return;
  }

  log.info({ homeId, deviceId }, "Fetching device status");
  try {
    const device = await getDeviceStatusService(homeId, deviceId, log);
    log.info({ homeId, deviceId }, "Device status retrieved");
    res.json({ device });
  } catch (error) {
    handleError(error, log, res, next);
  }
};

export const setDeviceMode: Controller = async (req, res, _next) => {
  const log = getRequestLogger(req).child({ route: "setDeviceMode" });
  const deviceId = parseNumericParam(log, req.params.deviceId, "deviceId", res);
  if (deviceId === null) {
    return;
  }

  const { mode, targetTemperature, fan, flags, homeId } = req.body ?? {};

  if (typeof homeId !== "number" || !Number.isFinite(homeId)) {
    const message = "Body must include a numeric 'homeId' field.";
    log.warn({ deviceId }, message);
    res.status(400).json({
      code: "INVALID_BODY",
      message,
    });
    return;
  }

  if (typeof mode !== "string" || mode.length === 0) {
    const message = "Body must include a non-empty 'mode' field.";
    log.warn({ deviceId }, message);
    res.status(400).json({
      code: "INVALID_BODY",
      message,
    });
    return;
  }

  if (!(mode in HVAC_MODES)) {
    const message = `Unsupported mode '${mode}'.`;
    log.warn({ deviceId, mode }, message);
    res.status(400).json({
      code: "INVALID_BODY",
      message,
    });
    return;
  }

  if (
    typeof targetTemperature !== "number" ||
    !Number.isFinite(targetTemperature)
  ) {
    const message = "Body must include a numeric 'targetTemperature' field.";
    log.warn({ deviceId }, message);
    res.status(400).json({
      code: "INVALID_BODY",
      message,
    });
    return;
  }

  const payload: CommandPayload = {
    mode: mode as CommandPayload["mode"],
    targetTemperature,
  };

  if (typeof fan === "string" && fan.length > 0) {
    if (!(fan in FAN_MODES)) {
      const message = `Unsupported fan mode '${fan}'.`;
      log.warn({ deviceId, fan }, message);
      res.status(400).json({
        code: "INVALID_BODY",
        message,
      });
      return;
    }
    payload.fan = fan as CommandPayload["fan"];
  }

  if (typeof flags === "number" && Number.isFinite(flags)) {
    payload.flags = flags as CommandPayload["flags"];
  }

  log.info(
    { deviceId, mode, targetTemperature, fan, flags, homeId },
    "Queueing device mode update",
  );

  const { jobId, position } = enqueueCommand({
    homeId,
    deviceId,
    payload,
    log,
  });

  res.status(202).json({
    jobId,
    position,
  });
};

export const streamDeviceEvents = (req: Request, res: Response): void => {
  const log = getRequestLogger(req).child({ route: "streamDeviceEvents" });
  registerClient(req, res, log);
};
