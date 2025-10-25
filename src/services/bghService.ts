import type { Logger } from "pino";
import logger from "../logger";
import {
  BGHApiError,
  BGHAuthenticationError,
  BGHClient,
  type BGHClientOptions,
  type DeviceStatus,
  type DeviceStatusMap,
  type HomeSummary,
} from "integrations/bgh";

export type BghServiceErrorCode =
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "UPSTREAM_ERROR"
  | "NOT_FOUND"
  | "UNEXPECTED_ERROR";

export class BGHServiceError extends Error {
  constructor(
    message: string,
    public readonly code: BghServiceErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BGHServiceError";
  }
}

export interface BghCredentials {
  email: string;
  password: string;
}

const TIMEOUT_ENV_KEY = "BGH_TIMEOUT_MS";

export async function listHomes(
  credentials: BghCredentials,
  log?: Logger,
): Promise<HomeSummary[]> {
  const svcLog = (log ?? logger).child({
    service: "bghService",
    operation: "listHomes",
    userEmail: credentials.email,
  });
  svcLog.debug("Listing homes from BGH API");
  try {
    const client = await createClient(credentials, svcLog);
    const homes = await client.listHomes();
    svcLog.info({ homeCount: homes.length }, "Homes retrieved from BGH");
    return homes;
  } catch (error) {
    throw normaliseError("listing homes", error, svcLog);
  }
}

export async function listDevices(
  credentials: BghCredentials,
  homeId: number,
  log?: Logger,
): Promise<DeviceStatusMap> {
  const svcLog = (log ?? logger).child({
    service: "bghService",
    operation: "listDevices",
    homeId,
    userEmail: credentials.email,
  });
  svcLog.debug("Retrieving devices for home");
  try {
    const client = await createClient(credentials, svcLog);
    const devices = await client.getDevices(homeId);
    svcLog.info(
      { deviceCount: Object.keys(devices).length },
      "Devices retrieved from BGH",
    );
    return devices;
  } catch (error) {
    throw normaliseError(
      `retrieving devices for home ${homeId}`,
      error,
      svcLog,
    );
  }
}

export async function getDeviceStatus(
  credentials: BghCredentials,
  homeId: number,
  deviceId: number,
  log?: Logger,
): Promise<DeviceStatus> {
  const svcLog = (log ?? logger).child({
    service: "bghService",
    operation: "getDeviceStatus",
    homeId,
    deviceId,
    userEmail: credentials.email,
  });
  svcLog.debug("Retrieving device status");
  try {
    const client = await createClient(credentials, svcLog);
    const device = await client.getDeviceStatus(homeId, deviceId);
    svcLog.info("Device status retrieved from BGH");
    return device;
  } catch (error) {
    throw normaliseError(
      `retrieving device ${deviceId} status for home ${homeId}`,
      error,
      svcLog,
    );
  }
}

export async function setDeviceMode(
  credentials: BghCredentials,
  deviceId: number,
  options: Parameters<BGHClient["setMode"]>[1],
  log?: Logger,
): Promise<Record<string, unknown>> {
  const svcLog = (log ?? logger).child({
    service: "bghService",
    operation: "setDeviceMode",
    deviceId,
    mode: options.mode,
    userEmail: credentials.email,
  });
  svcLog.info(
    { targetTemperature: options.targetTemperature, fan: options.fan },
    "Updating device mode in BGH API",
  );
  try {
    const client = await createClient(credentials, svcLog);
    const response = await client.setMode(deviceId, options);
    svcLog.info("Device mode updated in BGH");
    return response;
  } catch (error) {
    throw normaliseError(`updating mode for device ${deviceId}`, error, svcLog);
  }
}

async function createClient(
  credentials: BghCredentials,
  log?: Logger,
): Promise<BGHClient> {
  const scopedLog = (log ?? logger).child({
    service: "bghService",
    component: "client",
    userEmail: credentials.email,
  });
  const options: BGHClientOptions = {};
  const timeout = parseTimeout(scopedLog);
  if (timeout !== undefined) {
    options.timeoutMs = timeout;
    scopedLog.debug({ timeoutMs: timeout }, "Configured BGH timeout");
  }
  scopedLog.info("Initialising BGH client");
  return new BGHClient(credentials.email, credentials.password, options);
}

function parseTimeout(log: Logger): number | undefined {
  const rawTimeout = process.env[TIMEOUT_ENV_KEY];
  if (!rawTimeout) {
    return undefined;
  }
  const parsed = Number(rawTimeout);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.error({ value: rawTimeout }, "Invalid timeout value for BGH client");
    throw new BGHServiceError(
      `Invalid ${TIMEOUT_ENV_KEY} value. Expected a positive number, received '${rawTimeout}'.`,
      "CONFIGURATION_ERROR",
    );
  }
  return parsed;
}

function normaliseError(
  context: string,
  error: unknown,
  log: Logger,
): BGHServiceError {
  if (error instanceof BGHServiceError) {
    log.error({ err: error, context }, "BGH service error encountered");
    return error;
  }
  if (error instanceof BGHAuthenticationError) {
    const authError = new BGHServiceError(
      `BGH authentication failed while ${context}.`,
      "AUTHENTICATION_ERROR",
      error,
    );
    log.error({ err: authError, context }, "BGH authentication error");
    return authError;
  }
  if (error instanceof BGHApiError) {
    const apiError = new BGHServiceError(
      `BGH API request failed while ${context}. ${error.message}`,
      "UPSTREAM_ERROR",
      error,
    );
    log.error({ err: apiError, context }, "BGH API error");
    return apiError;
  }
  if (error instanceof Error && /not found/i.test(error.message)) {
    const notFound = new BGHServiceError(error.message, "NOT_FOUND", error);
    log.warn({ err: notFound, context }, "BGH resource not found");
    return notFound;
  }
  const unexpected = new BGHServiceError(
    `Unexpected error occurred while ${context}.`,
    "UNEXPECTED_ERROR",
    error,
  );
  log.error({ err: unexpected, context }, "Unexpected BGH service error");
  return unexpected;
}
