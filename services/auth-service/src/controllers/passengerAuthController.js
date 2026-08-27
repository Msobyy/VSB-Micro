// Thin HTTP adapter over passengerAuthService — same layering convention
// as the other services. Express 5 forwards a rejected promise from an
// async handler to errorHandler automatically, so these can just `throw`.
import { ApiError } from "@vsb/http-errors";

function requirePhoneFields(body) {
  const { countryCode, phoneNumber } = body ?? {};
  if (!countryCode || !phoneNumber) {
    throw ApiError.badRequest("countryCode and phoneNumber are required", { code: "INVALID_BODY" });
  }
  return { countryCode, phoneNumber };
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
    const { otp, deviceToken } = req.body ?? {};
    if (!otp || !deviceToken) {
      throw ApiError.badRequest("otp and deviceToken are required", { code: "INVALID_BODY" });
    }

    const result = await service.verifyOtpAndLogin({ countryCode, phoneNumber, otp, deviceToken });
    if (result.isNewUser) {
      return res.status(200).json({ isNewUser: true });
    }
    res.status(200).json({
      isNewUser: false,
      token: result.token,
      passenger: { id: result.passenger._id, firstName: result.passenger.firstName, phone: result.passenger.phone },
    });
  };
}

export function registerHandler(service) {
  return async (req, res) => {
    const { countryCode, phoneNumber } = requirePhoneFields(req.body);
    const { firstName, lastName, gender, deviceToken, email, city } = req.body ?? {};
    if (!firstName || !lastName || !gender || !deviceToken) {
      throw ApiError.badRequest("firstName, lastName, gender and deviceToken are required", { code: "INVALID_BODY" });
    }

    const { token, passenger } = await service.register({
      firstName,
      lastName,
      gender,
      countryCode,
      phoneNumber,
      deviceToken,
      email,
      city,
    });

    res.status(201).json({ token, passenger: { id: passenger._id, firstName: passenger.firstName, phone: passenger.phone } });
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
    const { token, deviceToken } = req.body ?? {};
    if (!token) {
      throw ApiError.badRequest("token is required", { code: "INVALID_BODY" });
    }
    const result = await service.verifyToken({ token, deviceToken });
    res.status(result.valid ? 200 : 401).json(result);
  };
}
