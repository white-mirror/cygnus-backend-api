import { Router } from "express";

import {
  currentUser,
  login,
  logout,
} from "../../src/controllers/authController";

const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", currentUser);

export default router;
