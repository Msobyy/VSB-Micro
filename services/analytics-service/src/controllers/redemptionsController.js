// Read-only query surface over the CQRS read model — proves the point of
// building it: a dashboard-style query analytics-service can answer
// entirely from its own collection, no fan-out call to promotions-service.
import { getRedemptionModel } from "../models/redemptionReadModel.js";

// Split out from the handler purely so it's unit-testable without a Mongo
// connection — every other line in this file needs one.
export function buildRedemptionQuery(query) {
  const filter = {};
  if (query.driverId) filter.driverId = query.driverId;
  if (query.couponCode) filter.couponCode = String(query.couponCode).toUpperCase();
  const limit = Math.min(Number(query.limit) || 50, 200);
  return { filter, limit };
}

export function listRedemptionsHandler(connection) {
  return async (req, res) => {
    const Redemption = getRedemptionModel(connection);
    const { filter, limit } = buildRedemptionQuery(req.query);
    const redemptions = await Redemption.find(filter).sort({ redeemedAt: -1 }).limit(limit);

    res.status(200).json({ count: redemptions.length, redemptions });
  };
}
