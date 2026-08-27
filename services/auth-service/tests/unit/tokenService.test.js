import { describe, it, expect } from "vitest";
import { signToken, decodeToken } from "../../src/services/tokenService.js";

describe("tokenService", () => {
  const secret = "test-secret";

  it("round-trips id and role through sign/decode", () => {
    const token = signToken({ id: "passenger_1", role: "passenger" }, secret);
    const decoded = decodeToken(token, secret);
    expect(decoded).toMatchObject({ id: "passenger_1", role: "passenger" });
  });

  it("returns null (never throws) for a token signed with a different secret", () => {
    const token = signToken({ id: "passenger_1", role: "passenger" }, "other-secret");
    expect(decodeToken(token, secret)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(decodeToken("not-a-jwt", secret)).toBeNull();
  });
});
