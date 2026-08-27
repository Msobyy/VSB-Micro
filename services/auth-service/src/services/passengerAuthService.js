// Business logic for passenger auth — the one file that matters in this
// service. Ports vsb-backend/controllers/passenger/authController.js's
// flow (send-otp -> verify-otp -> register-if-new, or login-if-existing;
// logout; a new verifyToken for other services to call) onto this
// monorepo's shared outbox/idempotency/event conventions.
import { withTransaction, getOutboxModel, buildOutboxDocument, buildEventEnvelope } from "@vsb/event-bus";
import { passengerRegisteredEventV1, PASSENGER_REGISTERED_TOPIC } from "@vsb/event-schemas";
import { ApiError } from "@vsb/http-errors";
import { getPassengerModel } from "../models/passengerModel.js";
import { signToken, decodeToken, signRegistrationTicket, verifyRegistrationTicket } from "./tokenService.js";

// QA / app-store-reviewer bypass, ported from vsb-backend's
// TEST_PHONE_NUMBERS/TEST_OTP constants — gated behind config.enableTestOtpBypass
// AND config.nodeEnv !== "production" (belt and suspenders: a single
// accidentally-true flag in a real deployment shouldn't be enough to
// open a zero-rate-limit login backdoor for two fixed numbers) rather
// than unconditionally active like the original.
const TEST_PHONE_NUMBERS = ["+923111111111", "+923000000000"];
const TEST_OTP = "123456";

function buildPhone(countryCode, phoneNumber) {
  return `${countryCode}${phoneNumber}`;
}

function isTestBypass(config, phone) {
  return config.enableTestOtpBypass && config.nodeEnv !== "production" && TEST_PHONE_NUMBERS.includes(phone);
}

export function createPassengerAuthService({ connection, otpService, config }) {
  const Passenger = getPassengerModel(connection);

  async function sendOtp({ countryCode, phoneNumber, isWhatsapp = false }) {
    const phone = buildPhone(countryCode, phoneNumber);
    if (isTestBypass(config, phone)) {
      return { success: true };
    }
    return otpService.sendOtp(phone, isWhatsapp ? "whatsapp" : "sms");
  }

  async function verifyOtpAndLogin({ countryCode, phoneNumber, otp, deviceToken }) {
    const phone = buildPhone(countryCode, phoneNumber);

    const verification = isTestBypass(config, phone) && otp === TEST_OTP
      ? { success: true }
      : await otpService.verifyOtp(phone, otp);

    if (!verification.success) {
      throw ApiError.badRequest(verification.message ?? "OTP verification failed", { code: "OTP_INVALID" });
    }

    const passenger = await Passenger.findOne({ phone, is_deleted: false });
    if (!passenger) {
      // Proof this phone was just OTP-verified, required by register()
      // below — without this, register() had no way to know an OTP was
      // ever checked at all (a real, exploited-in-audit vulnerability;
      // see that function's comment).
      const registrationTicket = signRegistrationTicket({ phone }, config.jwtSecret);
      return { isNewUser: true, phone, registrationTicket };
    }

    if (passenger.blockStatus?.isBlocked) {
      throw ApiError.conflict("This account has been blocked", {
        code: "ACCOUNT_BLOCKED",
        details: { reason: passenger.blockStatus.reason },
      });
    }

    const token = signToken({ id: passenger._id.toString(), role: passenger.role }, config.jwtSecret);
    passenger.currentToken = token;
    passenger.deviceToken = deviceToken;
    passenger.lastLogin = new Date();
    await passenger.save();

    return { isNewUser: false, token, passenger };
  }

  // firstName/lastName/gender/email/city are accepted here (the client
  // collects them in the same signup screen as OTP verification — a UX
  // call, not an architecture one) but deliberately NOT persisted on the
  // Passenger document — that's profile data, a future passenger-
  // service's job to own. They flow into the event payload below (for
  // passenger-service to build its own record from) and straight back
  // into the HTTP response, without ever touching this service's DB.
  //
  // registrationTicket is REQUIRED and must have been issued by
  // verifyOtpAndLogin for this exact phone: without it, nothing stopped
  // anyone from calling this endpoint directly for any never-registered
  // phone number and walking away with a fully valid session — no OTP
  // ever checked. Caught in a security audit before this service gained
  // any dependents; see docs/architecture-decision-records for the
  // writeup if one gets added.
  //
  // KNOWN GAP: email uniqueness isn't enforced here since email isn't
  // stored — auth-service only owns phone as a login identifier, and
  // email was never actually used to log in anywhere in this system.
  // That constraint becomes passenger-service's job once it exists.
  async function register({ firstName, lastName, gender, countryCode, phoneNumber, deviceToken, email, city, registrationTicket }) {
    const phone = buildPhone(countryCode, phoneNumber);

    if (!isTestBypass(config, phone)) {
      const ticket = verifyRegistrationTicket(registrationTicket, phone, config.jwtSecret);
      if (!ticket) {
        throw ApiError.unauthorized("Missing or expired OTP verification for this phone", { code: "OTP_NOT_VERIFIED" });
      }
    }

    const Outbox = getOutboxModel(connection);

    const existing = await Passenger.findOne({ phone, is_deleted: false });
    if (existing) {
      throw ApiError.conflict("An account with this phone already exists", { code: "ACCOUNT_EXISTS" });
    }

    return withTransaction(connection, async (session) => {
      let passenger;
      try {
        [passenger] = await Passenger.create([{ phone, is_verified: true }], { session });
      } catch (err) {
        // The pre-check above can race a concurrent register() for the
        // same phone; the unique index is what actually prevents a
        // duplicate row, this just turns that into a clean 409 instead
        // of an unhandled 500 for whichever request loses the race.
        if (err.code === 11000) {
          throw ApiError.conflict("An account with this phone already exists", { code: "ACCOUNT_EXISTS" });
        }
        throw err;
      }

      const token = signToken({ id: passenger._id.toString(), role: passenger.role }, config.jwtSecret);
      passenger.currentToken = token;
      passenger.deviceToken = deviceToken;
      passenger.lastLogin = new Date();
      await passenger.save({ session });

      const profile = { firstName, lastName, gender, email, city };

      const envelope = buildEventEnvelope({
        eventType: PASSENGER_REGISTERED_TOPIC,
        eventVersion: 1,
        source: "auth-service",
        partitionKey: passenger._id.toString(),
        payload: { passengerId: passenger._id.toString(), phone: passenger.phone, ...profile },
      });

      const parsed = passengerRegisteredEventV1.safeParse(envelope);
      if (!parsed.success) {
        throw ApiError.badRequest("Registration profile fields failed validation", {
          code: "INVALID_PROFILE",
          details: parsed.error.issues,
        });
      }

      await Outbox.create(
        [buildOutboxDocument({ eventId: envelope.eventId, topic: PASSENGER_REGISTERED_TOPIC, partitionKey: passenger._id.toString(), envelope })],
        { session },
      );

      return { token, passenger, profile };
    });
  }

  async function logout({ passengerId }) {
    await Passenger.findByIdAndUpdate(passengerId, { currentToken: null, deviceToken: null });
  }

  /** The point of this whole service: lets another service confirm a
   * token is real AND not revoked (logout/block), not just unexpired.
   * `deviceToken` must already be a plain string by the time it gets
   * here — see the controller's requireString() call — otherwise an
   * object like {$ne: null} in this filter would match any document
   * (a real, exploited-in-audit NoSQL injection that bypassed the
   * device-binding half of this check entirely). */
  async function verifyToken({ token, deviceToken }) {
    const decoded = decodeToken(token, config.jwtSecret);
    if (!decoded) return { valid: false };

    const passenger = await Passenger.findOne({
      _id: decoded.id,
      currentToken: token,
      deviceToken,
      is_deleted: false,
    });
    if (!passenger) return { valid: false };

    if (passenger.blockStatus?.isBlocked) {
      passenger.currentToken = null;
      passenger.deviceToken = null;
      await passenger.save();
      return { valid: false };
    }

    return { valid: true, passenger: { id: passenger._id.toString(), role: passenger.role, phone: passenger.phone } };
  }

  return { sendOtp, verifyOtpAndLogin, register, logout, verifyToken };
}
