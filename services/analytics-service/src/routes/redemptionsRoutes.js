import { Router } from "express";
import { listRedemptionsHandler } from "../controllers/redemptionsController.js";

export function redemptionsRoutes(connection) {
  const router = Router();
  router.get("/", listRedemptionsHandler(connection));
  return router;
}
