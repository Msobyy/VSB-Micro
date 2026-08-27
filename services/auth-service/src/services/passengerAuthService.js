// Business logic for passenger auth — the one file that matters in this
// service. Ports vsb-backend/controllers/passenger/authController.js's
// flow (send-otp -> verify-otp -> register-if-new, or login-if-existing;
// logout; a new verifyToken for other services to call) onto this
// monorepo's shared outbox/idempotency/event conventions.
import { withTransaction, getOutboxModel, buildOutboxDocument, buildEventEnvelope } from "@vsb/event-bus";
import { passengerRegisteredEventV1, PASSENGER_REGISTERED_TOPIC } from "@vsb/event-schemas";
import { ApiError } from "@vsb/http-errors";
import { getPassengerModel } from "../models/passengerModel.js";
import { signToken, decodeToken } from "./tokenService.js";

// QA / app-store-reviewer bypass, ported from vsb-backend's
// TEST_PHONE_NUMBERS/TEST_OTP constants — gated behind config.enableTestOtpBypass
// rather than unconditionally active like the original, since this is a
// reusable service, not a single known deployment.
const TEST_PHONE_NUMBERS = ["+923111111111", "+923000000000"];
const TEST_OTP = "123456";

function buildPhone(countryCode, phoneNumber) {
  return `${countryCode}${phoneNumber}`;
}

function isTestBypass(config, phone) {
  return config.enableTestOtpBypass && TEST_PHONE_NUMBERS.includes(phone);
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
      return { isNewUser: true, phone };
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

  async function register({ firstName, lastName, gender, countryCode, phoneNumber, deviceToken, email, city }) {
    const phone = buildPhone(countryCode, phoneNumber);
    const Outbox = getOutboxModel(connection);

    const existing = await Passenger.findOne({
      is_deleted: false,
      $or: [{ phone }, ...(email ? [{ email }] : [])],
    });
    if (existing) {
      throw ApiError.conflict("An account with this phone or email already exists", { code: "ACCOUNT_EXISTS" });
    }

    return withTransaction(connection, async (session) => {
      const [passenger] = await Passenger.create(
        [{ firstName, lastName, gender, phone, email, city, is_verified: true }],
        { session },
      );

      const token = signToken({ id: passenger._id.toString(), role: passenger.role }, config.jwtSecret);
      passenger.currentToken = token;
      passenger.deviceToken = deviceToken;
      passenger.lastLogin = new Date();
      await passenger.save({ session });

      const envelope = buildEventEnvelope({
        eventType: PASSENGER_REGISTERED_TOPIC,
        eventVersion: 1,
        source: "auth-service",
        partitionKey: passenger._id.toString(),
        payload: { passengerId: passenger._id.toString(), firstName: passenger.firstName, phone: passenger.phone },
      });

      const parsed = passengerRegisteredEventV1.safeParse(envelope);
      if (!parsed.success) {
        throw ApiError.internal("Built an event that fails its own schema", {
          code: "EVENT_SCHEMA_VIOLATION",
          details: parsed.error.issues,
        });
      }

      await Outbox.create(
        [buildOutboxDocument({ eventId: envelope.eventId, topic: PASSENGER_REGISTERED_TOPIC, partitionKey: passenger._id.toString(), envelope })],
        { session },
      );

      return { token, passenger };
    });
  }

  async function logout({ passengerId }) {
    await Passenger.findByIdAndUpdate(passengerId, { currentToken: null, deviceToken: null });
  }

  /** The point of this whole service: lets another service confirm a
   * token is real AND not revoked (logout/block), not just unexpired. */
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
