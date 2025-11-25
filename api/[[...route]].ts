import type { IncomingMessage, ServerResponse } from "http";
import app from "../src/app";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  app(req as never, res as never);
}
