import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import type { Logger } from "pino";

type SSEClient = {
  id: string;
  res: Response;
  log: Logger;
  heartbeat: NodeJS.Timeout;
};

const HEARTBEAT_INTERVAL_MS = 25_000;

const clients = new Map<string, SSEClient>();

const removeClient = (clientId: string): void => {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }
  clearInterval(client.heartbeat);
  clients.delete(clientId);
  try {
    client.res.end();
  } catch {
    // Ignore downstream errors on teardown.
  }
  client.log.info({ clientId }, "SSE client disconnected");
};

export const registerClient = (
  req: Request,
  res: Response,
  log: Logger,
): void => {
  const clientId = randomUUID();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  const client: SSEClient = {
    id: clientId,
    res,
    log,
    heartbeat: setInterval(() => {}, HEARTBEAT_INTERVAL_MS),
  };

  clearInterval(client.heartbeat);
  client.heartbeat = setInterval(() => {
    try {
      client.res.write(": heartbeat\n\n");
    } catch (error) {
      client.log.warn({ err: error }, "Failed to send heartbeat, closing");
      removeClient(client.id);
    }
  }, HEARTBEAT_INTERVAL_MS);

  clients.set(clientId, client);
  log.info(
    { clientId, connectedClients: clients.size },
    "SSE client connected",
  );

  req.on("close", () => {
    removeClient(clientId);
  });
};

export const broadcastEvent = (event: string, payload: unknown): void => {
  const data = JSON.stringify(payload);
  for (const client of clients.values()) {
    try {
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${data}\n\n`);
    } catch (error) {
      client.log.warn(
        { err: error, event },
        "Failed to push SSE event, dropping client",
      );
      removeClient(client.id);
    }
  }
};

export const connectedClients = (): number => clients.size;
