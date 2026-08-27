// Single entry point that routes REST calls to services and verifies JWTs
// at the edge (see middlewares/authMiddleware.js). Routing convention: each
// service owns its own full `/api/v1/<service>/*` path namespace (same as
// vsb-backend/vsb-crm-backend already do), so proxying is a pure
// passthrough — no path rewriting.
//
// Deliberately mounted via `pathFilter` at the app root rather than
// `app.use('/api/v1/promotions', proxy)`: Express's path-prefix mounting
// strips the matched prefix from req.url before the proxy middleware ever
// sees it, which combined with a known http-proxy-middleware v3+ issue
// (an extra "/" gets inserted before query params when the target includes
// a path) causes 404s on requests with query strings. Root-mounting with
// pathFilter keeps req.url untouched and the target bare (host only, no
// path), sidestepping both problems.
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { attachUser } from "./middlewares/authMiddleware.js";

export function createApp({ config, logger }) {
  const app = express();
  app.use(attachUser(config, logger));

  app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

  app.use(
    createProxyMiddleware({
      pathFilter: "/api/v1/promotions/**",
      target: config.promotionsServiceUrl,
      logger,
    }),
  );
  app.use(
    createProxyMiddleware({
      pathFilter: "/api/v1/analytics/**",
      target: config.analyticsServiceUrl,
      logger,
    }),
  );
  app.use(
    createProxyMiddleware({
      pathFilter: "/api/v1/auth/**",
      target: config.authServiceUrl,
      logger,
    }),
  );

  app.use((req, res) => res.status(404).json({ error: { message: "No route for this path", code: "NOT_FOUND" } }));

  return app;
}
