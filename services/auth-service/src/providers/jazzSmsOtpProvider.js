// Real SMS delivery via JazzCMT, ported from
// vsb-backend/services/otpService.js's send path. JazzCMT's gateway always
// responds HTTP 200 regardless of outcome, so success/failure has to be
// parsed out of the response body text instead of the status code.
// httpsAgent forces IPv4 — carried over from the original's comment that
// JazzCMT's WAF blocks outbound IPv6 from at least one of the original
// deployment's networks; harmless to keep even if this deployment doesn't
// hit that specific issue.
//
// Self-describing provider module — see otpProvider.js's header comment
// for the contract this satisfies (channel/isConfigured/create).
import https from "node:https";
import axios from "axios";

const JAZZ_SMS_URL = "https://connect.jazzcmt.com/sendsms_url.html";
const ipv4Agent = new https.Agent({ family: 4 });

export const channel = "sms";

export function isConfigured(config) {
  return Boolean(config.jazz.username && config.jazz.password);
}

function buildMessage(otp) {
  return `Your VSisters verification code is ${otp}. It expires in 5 minutes.`;
}

export function create(config, logger) {
  const { username, password } = config.jazz;

  return {
    name: "jazz-sms",
    async sendOtp({ phone, otp }) {
      const params = {
        Username: username,
        Password: password,
        From: "VSisters",
        To: phone,
        Message: buildMessage(otp),
      };

      try {
        const response = await axios.get(JAZZ_SMS_URL, { params, httpsAgent: ipv4Agent, timeout: 10000 });
        const body = String(response.data ?? "");
        const success = body.startsWith("1701") || /sent successfully/i.test(body);
        if (!success) {
          logger.error({ phone, body }, "jazz sms gateway rejected the request");
        }
        return { success };
      } catch (err) {
        logger.error({ err: err.message, phone }, "jazz sms send failed");
        return { success: false };
      }
    },
  };
}
