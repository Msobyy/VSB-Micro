import { describe, it, expect } from "vitest";
import { buildProfileUpdate } from "../../src/controllers/passengerProfileController.js";

describe("buildProfileUpdate", () => {
  it("builds an update object from valid fields", () => {
    expect(buildProfileUpdate({ firstName: "Amina", city: "Lahore" })).toEqual({
      firstName: "Amina",
      city: "Lahore",
    });
  });

  it("lowercases email", () => {
    expect(buildProfileUpdate({ email: "Amina@Example.COM" })).toEqual({ email: "amina@example.com" });
  });

  it("rejects an empty body with no valid fields", () => {
    expect(() => buildProfileUpdate({})).toThrow(/No valid fields/);
  });

  it("rejects a city outside the enum", () => {
    expect(() => buildProfileUpdate({ city: "Atlantis" })).toThrow(/city must be one of/);
  });

  it("rejects a gender outside the enum", () => {
    expect(() => buildProfileUpdate({ gender: "unknown" })).toThrow(/gender must be one of/);
  });

  it("rejects a non-string value for a string field", () => {
    expect(() => buildProfileUpdate({ firstName: { $ne: null } })).toThrow(/firstName must be a string/);
  });

  it("rejects an overly long value", () => {
    expect(() => buildProfileUpdate({ firstName: "a".repeat(101) })).toThrow(/firstName must be a string/);
  });
});
