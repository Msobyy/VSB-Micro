// Thin HTTP adapter over passengerAuthService — same layering convention
// as the other services. Express 5 forwards a rejected promise from an
// async handler to errorHandler automatically, so these can just `throw`.
import { ApiError } from "@vsb/http-errors";

const COUNTRY_CODE_RE = /^\+\d{1,4}$/;
const PHONE_NUMBER_RE = /^\d{6,14}$/;
const GENDERS = ["Male", "Female", "Other"];

// Every field that flows into a Mongo query filter (deviceToken, most
// dangerously — see verifyToken() in passengerAuthService.js) or a paid
// SMS/WhatsApp send (phone) MUST be validated as a plain string of a
// sane shape here, before it reaches the service layer. A JSON body can
// carry an object where a string is expected (e.g. deviceToken:
// {"$ne": null}), and neither Express nor Mongoose reject that on their
// own — a real NoSQL-operator-injection bug in this exact spot bypassed
// device-session binding entirely until this check was added.
function requireString(value, fieldName, { minLength = 1, maxLength = 256 } = {}) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    throw ApiError.badRequest(`${fieldName} must be a string between ${minLength} and ${maxLength} characters`, {
      code: "INVALID_BODY",
    });
  }
  return value;
}

function requirePhoneFields(body) {
  const countryCode = requireString(body?.countryCode, "countryCode", { maxLength: 5 });
  const phoneNumber = requireString(body?.phoneNumber, "phoneNumber", { maxLength: 14 });
  if (!COUNTRY_CODE_RE.test(countryCode)) {
    throw ApiError.badRequest("countryCode must look like +XX", { code: "INVALID_BODY" });
  }
  if (!PHONE_NUMBER_RE.test(phoneNumber)) {
    throw ApiError.badRequest("phoneNumber must be 6-14 digits", { code: "INVALID_BODY" });
  }
  return { countryCode, phoneNumber };
}

// Device push tokens are opaque and their real entropy can't be verified
// server-side, but a minimum length floor at least blocks the trivial
// case (deviceToken: "1") from ever being accepted as a session binding.
function requireDeviceToken(body) {
  return requireString(body?.deviceToken, "deviceToken", { minLength: 8, maxLength: 512 });
}

export function sendOtpHandler(service) {
  return async (req, res) => {
    const { countryCode, phoneNumber } = requirePhoneFields(req.body);
    const isWhatsapp = Boolean(req.body?.is_whatsapp);
    const result = await service.sendOtp({ countryCode, phoneNumber, isWhatsapp });
    res.status(result.success ? 200 : 429).json(result);
  };
}

export function verifyOtpHandler(service) {
  return async (req, res) => {
    const { countryCode, phoneNumber } = requirePhoneFields(req.body);
    const otp = requireString(req.body?.otp, "otp", { minLength: 4, maxLength: 8 });
    const deviceToken = requireDeviceToken(req.body);

    const result = await service.verifyOtpAndLogin({ countryCode, phoneNumber, otp, deviceToken });
    if (result.isNewUser) {
      return res.status(200).json({ isNewUser: true, registrationTicket: result.registrationTicket });
    }
    // No firstName here — auth-service doesn't store profile data (see
    // passengerAuthService.js's register() comment). A client that needs
    // the passenger's name for display calls passenger-service for it,
    // once it exists.
    res.status(200).json({
      isNewUser: false,
      token: result.token,
      passenger: { id: result.passenger._id, phone: result.passenger.phone },
    });
  };
}

export function registerHandler(service) {
  return async (req, res) => {
    const { countryCode, phoneNumber } = requirePhoneFields(req.body);
    const deviceToken = requireDeviceToken(req.body);
    const firstName = requireString(req.body?.firstName, "firstName", { maxLength: 100 });
    const lastName = requireString(req.body?.lastName, "lastName", { maxLength: 100 });
    const gender = requireString(req.body?.gender, "gender", { maxLength: 10 });
    if (!GENDERS.includes(gender)) {
      throw ApiError.badRequest(`gender must be one of: ${GENDERS.join(", ")}`, { code: "INVALID_BODY" });
    }
    const registrationTicket = requireString(req.body?.registrationTicket, "registrationTicket", { maxLength: 2000 });
    const email = req.body?.email !== undefined ? requireString(req.body.email, "email", { maxLength: 254 }) : undefined;
    const city = req.body?.city !== undefined ? requireString(req.body.city, "city", { maxLength: 100 }) : undefined;

    const { token, passenger, profile } = await service.register({
      firstName,
      lastName,
      gender,
      countryCode,
      phoneNumber,
      deviceToken,
      email,
      city,
      registrationTicket,
    });

    // profile fields are echoed straight from the request — the client
    // just typed them, no need to round-trip through this service's DB
    // (which doesn't store them; see passengerAuthService.js).
    res.status(201).json({ token, passenger: { id: passenger._id, phone: passenger.phone, ...profile } });
  };
}

export function logoutHandler(service) {
  return async (req, res) => {
    await service.logout({ passengerId: req.user.id });
    res.status(200).json({ success: true });
  };
}

export function verifyTokenHandler(service) {
  return async (req, res) => {
    const token = requireString(req.body?.token, "token", { maxLength: 2000 });
    const deviceToken = requireDeviceToken(req.body);
    const result = await service.verifyToken({ token, deviceToken });
    res.status(result.valid ? 200 : 401).json(result);
  };
}
