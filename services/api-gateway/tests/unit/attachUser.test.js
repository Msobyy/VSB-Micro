import { describe, it, expect, vi, afterEach } from "vitest";
import { attachUser } from "../../src/middlewares/authMiddleware.js";

function mockReq(headers = {}) {
  return { headers };
}
function mockLogger() {
  return { warn: vi.fn() };
}

describe("attachUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes through untouched when there's no bearer token", async () => {
    const req = mockReq();
    const next = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await attachUser({ authServiceUrl: "http://auth" }, mockLogger())(req, {}, next);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("attaches req.user when auth-service reports the token valid", async () => {
    const req = mockReq({ authorization: "Bearer good-token", "device-token": "device-1" });
    const next = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ valid: true, passenger: { id: "p1", role: "passenger" } }) }),
    );

    await attachUser({ authServiceUrl: "http://auth" }, mockLogger())(req, {}, next);

    expect(req.user).toEqual({ id: "p1", role: "passenger" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("still calls next() without attaching req.user when the token is invalid", async () => {
    const req = mockReq({ authorization: "Bearer bad-token", "device-token": "device-1" });
    const next = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ valid: false }) }));

    await attachUser({ authServiceUrl: "http://auth" }, mockLogger())(req, {}, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("still calls next() (non-blocking) when the auth-service call itself fails", async () => {
    const req = mockReq({ authorization: "Bearer good-token", "device-token": "device-1" });
    const next = vi.fn();
    const logger = mockLogger();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    await attachUser({ authServiceUrl: "http://auth" }, logger)(req, {}, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
