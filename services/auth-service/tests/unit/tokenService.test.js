import { describe, it, expect } from "vitest";
import { signToken, decodeToken, signRegistrationTicket, verifyRegistrationTicket } from "../../src/services/tokenService.js";

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

describe("registration ticket", () => {
  const secret = "test-secret";

  it("verifies successfully for the exact phone it was issued for", () => {
    const ticket = signRegistrationTicket({ phone: "+923001234567" }, secret);
    expect(verifyRegistrationTicket(ticket, "+923001234567", secret)).toMatchObject({ phone: "+923001234567" });
  });

  it("rejects a ticket presented for a different phone number", () => {
    const ticket = signRegistrationTicket({ phone: "+923001234567" }, secret);
    expect(verifyRegistrationTicket(ticket, "+923009999999", secret)).toBeNull();
  });

  it("rejects a real session token used as a registration ticket", () => {
    const sessionToken = signToken({ id: "passenger_1", role: "passenger" }, secret);
    expect(verifyRegistrationTicket(sessionToken, "+923001234567", secret)).toBeNull();
  });

  it("rejects a ticket signed with a different secret", () => {
    const ticket = signRegistrationTicket({ phone: "+923001234567" }, "other-secret");
    expect(verifyRegistrationTicket(ticket, "+923001234567", secret)).toBeNull();
  });
});
