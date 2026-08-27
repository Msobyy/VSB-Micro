import { describe, it, expect, vi } from "vitest";
import { ApiError, errorHandler, notFoundHandler } from "../src/index.js";

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

describe("ApiError", () => {
  it("builds well-known status codes via static helpers", () => {
    expect(ApiError.notFound("missing").statusCode).toBe(404);
    expect(ApiError.badRequest("bad").statusCode).toBe(400);
    expect(ApiError.conflict("dup").statusCode).toBe(409);
    expect(ApiError.unauthorized("nope").statusCode).toBe(401);
  });
});

describe("errorHandler", () => {
  it("responds with the ApiError's status and message", () => {
    const logger = mockLogger();
    const res = mockRes();
    const handler = errorHandler(logger);

    handler(ApiError.notFound("coupon not found", { code: "COUPON_NOT_FOUND" }), { path: "/x", method: "GET" }, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "coupon not found", code: "COUPON_NOT_FOUND", details: undefined },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("masks unexpected errors as a generic 500", () => {
    const logger = mockLogger();
    const res = mockRes();
    const handler = errorHandler(logger);

    handler(new Error("db exploded"), { path: "/x", method: "GET" }, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Internal server error", code: "INTERNAL_ERROR", details: undefined },
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it("masks message and details for a deliberate ApiError.internal() too, not just unexpected exceptions", () => {
    const logger = mockLogger();
    const res = mockRes();
    const handler = errorHandler(logger);

    handler(
      ApiError.internal("zod schema dump", { code: "EVENT_SCHEMA_VIOLATION", details: { secretInternals: true } }),
      { path: "/x", method: "GET" },
      res,
      () => {},
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Internal server error", code: "EVENT_SCHEMA_VIOLATION", details: undefined },
    });
  });
});

describe("notFoundHandler", () => {
  it("responds 404", () => {
    const res = mockRes();
    notFoundHandler({}, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
