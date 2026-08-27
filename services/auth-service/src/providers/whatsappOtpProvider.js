// Real OTP delivery via WhatsApp Business Cloud API, ported from
// vsb-backend/services/whatsappOTPService.js's send path.
//
// Self-describing provider module — see otpProvider.js's header comment
// for the contract this satisfies (channel/isConfigured/create).
import axios from "axios";

export const channel = "whatsapp";

export function isConfigured(config) {
  return Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
}

export function create(config, logger) {
  const { accessToken, phoneNumberId, templateName, languageCode } = config.whatsapp;
  const apiUrl = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  return {
    name: "whatsapp",
    async sendOtp({ phone, otp }) {
      // WhatsApp expects the number without a leading "+".
      const to = phone.replace(/^\+/, "");
      const payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            { type: "body", parameters: [{ type: "text", text: otp }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `otp${otp}` }] },
          ],
        },
      };

      try {
        const response = await axios.post(apiUrl, payload, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        });
        return { success: response.status === 200 };
      } catch (err) {
        logger.error({ err: err.message, phone }, "whatsapp otp send failed");
        return { success: false };
      }
    },
  };
}
