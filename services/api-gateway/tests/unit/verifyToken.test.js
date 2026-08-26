import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { verifyToken } from "../../src/middlewares/authMiddleware.js";

describe("verifyToken", () => {
  const secret = "test-secret";

  it("returns the decoded payload for a token signed with the same secret", () => {
    const token = jwt.sign({ sub: "user_1" }, secret);
    expect(verifyToken(token, secret).sub).toBe("user_1");
  });

  it("throws for a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "user_1" }, "wrong-secret");
    expect(() => verifyToken(token, secret)).toThrow();
  });

  it("throws for a malformed token", () => {
    expect(() => verifyToken("not-a-jwt", secret)).toThrow();
  });
});
