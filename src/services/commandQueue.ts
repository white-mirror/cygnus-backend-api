import { randomUUID } from "crypto";
import type { Logger } from "pino";
import type { DeviceStatus } from "integrations/bgh";
import { FAN_MODES, HVAC_MODES } from "integrations/bgh/client";
import {
  getDeviceStatus,
  setDeviceMode,
  type BGHServiceError,
  type BghCredentials,
} from "./bghService";
import { broadcastEvent } from "./eventStream";

export type ModeKey = keyof typeof HVAC_MODES;
export type FanKey = keyof typeof FAN_MODES;

export interface CommandPayload {
  mode: ModeKey;
  targetTemperature: number;
  fan?: FanKey;
  flags?: number;
}

export interface CommandJobInput {
  credentials: BghCredentials;
  homeId: number;
  deviceId: number;
  payload: CommandPayload;
  log: Logger;
}

interface CommandJob extends CommandJobInput {
  id: string;
  enqueuedAt: number;
}

type CommandResult =
  | { status: "completed"; job: CommandJob; device: DeviceStatus; attempts: number }
  | { status: "failed"; job: CommandJob; error: Error; attempts: number };

const POLL_DELAY_MS = 750;
const MAX_ATTEMPTS = 6;

const queue: CommandJob[] = [];
let isProcessing = false;

const matchesExpected = (
  device: DeviceStatus,
  payload: CommandPayload,
): boolean => {
  const expectedMode = HVAC_MODES[payload.mode];
  const expectedFan =
    payload.fan !== undefined ? FAN_MODES[payload.fan] : undefined;

  const modeMatches =
    expectedMode === undefined || device.modeId === expectedMode;
  const fanMatches =
    expectedFan === undefined || device.fanSpeed === expectedFan;
  const temperatureMatches =
    typeof device.targetTemperature !== "number"
      ? false
      : Math.round(device.targetTemperature) ===
        Math.round(payload.targetTemperature);

  return modeMatches && fanMatches && temperatureMatches;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const pollForStatus = async (
  job: CommandJob,
  log: Logger,
): Promise<{ device: DeviceStatus; attempts: number }> => {
  let lastDevice: DeviceStatus | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const device = await getDeviceStatus(
        job.credentials,
        job.homeId,
        job.deviceId,
        log,
      );
      lastDevice = device;
      if (matchesExpected(device, job.payload)) {
        return { device, attempts: attempt };
      }
    } catch (error) {
      log.warn(
        { jobId: job.id, deviceId: job.deviceId, attempt, error },
        "Failed to fetch device status while polling",
      );
    }
    await wait(POLL_DELAY_MS);
  }

  if (!lastDevice) {
    throw new Error("No se pudo obtener el estado actualizado del dispositivo");
  }

  return { device: lastDevice, attempts: MAX_ATTEMPTS };
};

const publishResult = (result: CommandResult): void => {
  if (result.status === "completed") {
    broadcastEvent("device-update", {
      jobId: result.job.id,
      homeId: result.job.homeId,
      deviceId: result.job.deviceId,
      device: result.device.toJSON(),
      attempts: result.attempts,
    });
    return;
  }

  broadcastEvent("command-error", {
    jobId: result.job.id,
    homeId: result.job.homeId,
    deviceId: result.job.deviceId,
    message: result.error.message,
  });
};

const runJob = async (job: CommandJob): Promise<void> => {
  const jobLog = job.log.child({
    jobId: job.id,
    deviceId: job.deviceId,
    homeId: job.homeId,
  });
  jobLog.info("Processing queued device command");

  try {
    await setDeviceMode(job.credentials, job.deviceId, job.payload, jobLog);
    const { device, attempts } = await pollForStatus(job, jobLog);
    jobLog.info({ attempts }, "Device command completed");
    publishResult({ status: "completed", job, device, attempts });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error : (error as BGHServiceError);
    jobLog.error({ err: failureReason }, "Device command failed");
    publishResult({
      status: "failed",
      job,
      error: failureReason instanceof Error ? failureReason : new Error(String(failureReason)),
      attempts: 0,
    });
  }
};

const processQueue = async (): Promise<void> => {
  if (isProcessing) {
    return;
  }
  isProcessing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      break;
    }
    try {
      await runJob(job);
    } catch (error) {
      job.log.error({ err: error, jobId: job.id }, "Command job crashed");
      publishResult({
        status: "failed",
        job,
        error:
          error instanceof Error
            ? error
            : new Error("Fallo inesperado al procesar el comando"),
        attempts: 0,
      });
    }
  }

  isProcessing = false;
};

export const enqueueCommand = ({
  credentials,
  homeId,
  deviceId,
  payload,
  log,
}: CommandJobInput): { jobId: string; position: number } => {
  const job: CommandJob = {
    id: randomUUID(),
    credentials,
    homeId,
    deviceId,
    payload,
    log,
    enqueuedAt: Date.now(),
  };

  queue.push(job);
  log.info(
    { jobId: job.id, queueDepth: queue.length },
    "Queued device command",
  );
  void processQueue();

  return {
    jobId: job.id,
    position: queue.length,
  };
};
