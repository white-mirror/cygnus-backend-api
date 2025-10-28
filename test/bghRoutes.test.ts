import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import bghRoutes from "../app/routes/bghRoutes";
import * as bghService from "../src/services/bghService";
import type { HomeSummary } from "../integrations/bgh";

describe("BGH routes", () => {
  const createApp = () => {
    const app = express();
    app.use(express.json());
    app.use("/api/bgh", bghRoutes);
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected server error.",
        });
      },
    );
    return app;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns homes from the service", async () => {
    const homes: HomeSummary[] = [{ id: 1 } as HomeSummary];
    const listHomesMock = vi
      .spyOn(bghService, "listHomes")
      .mockResolvedValue(homes);

    const response = await request(createApp())
      .get("/api/bgh/homes")
      .expect(200);

    expect(response.body).toEqual({ homes });
    expect(listHomesMock).toHaveBeenCalledTimes(1);
  });

  it("validates numeric parameters before calling the service", async () => {
    const listDevicesMock = vi.spyOn(bghService, "listDevices");

    const response = await request(createApp())
      .get("/api/bgh/homes/abc/devices")
      .expect(400);

    expect(response.body).toMatchObject({
      code: "INVALID_PARAMETER",
    });
    expect(listDevicesMock).not.toHaveBeenCalled();
  });

  it("maps BGH service errors to HTTP status codes", async () => {
    const error = new bghService.BGHServiceError(
      "Devices not found",
      "NOT_FOUND",
    );
    vi.spyOn(bghService, "listDevices").mockRejectedValue(error);

    const response = await request(createApp())
      .get("/api/bgh/homes/1/devices")
      .expect(404);

    expect(response.body).toEqual({
      code: "NOT_FOUND",
      message: "Devices not found",
    });
  });

  it("validates request body when updating device mode", async () => {
    const setDeviceModeMock = vi.spyOn(bghService, "setDeviceMode");

    const response = await request(createApp())
      .post("/api/bgh/devices/42/mode")
      .send({ mode: "cool" })
      .expect(400);

    expect(response.body).toMatchObject({
      code: "INVALID_BODY",
    });
    expect(setDeviceModeMock).not.toHaveBeenCalled();
  });

  it("forwards successful mode updates", async () => {
    const result = { success: true };
    const setDeviceModeMock = vi
      .spyOn(bghService, "setDeviceMode")
      .mockResolvedValue(result);

    const response = await request(createApp())
      .post("/api/bgh/devices/7/mode")
      .send({ mode: "cool", targetTemperature: 21 })
      .expect(200);

    expect(response.body).toEqual({ result });
    expect(setDeviceModeMock).toHaveBeenCalledWith(7, {
      mode: "cool",
      targetTemperature: 21,
      fan: undefined,
      flags: undefined,
    });
  });
});
