import { Router } from "express";
import {
  getDeviceStatus,
  listDevices,
  listHomes,
  setDeviceMode,
} from "../../src/controllers/bghController";
import { requireAuth } from "../../src/middleware/requireAuth";

const router = Router();

router.use(requireAuth);

router.get("/homes", listHomes);
router.get("/homes/:homeId/devices", listDevices);
router.get("/homes/:homeId/devices/:deviceId", getDeviceStatus);
router.post("/devices/:deviceId/mode", setDeviceMode);

export default router;
