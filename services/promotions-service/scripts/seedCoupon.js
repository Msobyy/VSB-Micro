// One-off seed script — same convention as
// vsb-backend/scripts/seedFirstRideCoupon.js. There's no admin
// create-coupon endpoint in this pilot (only redemption, per its scope —
// see CLAUDE.md), so this is how a coupon gets into the database for local
// testing / the docs/event-catalog.md walkthrough.
//
// Usage: node scripts/seedCoupon.js [code] [type] [value]
//   node scripts/seedCoupon.js TEST10 flat 150
import mongoose from "mongoose";
import { config } from "../src/config/index.js";
import { getCouponModel } from "../src/models/couponModel.js";

const [code = "TEST10", type = "flat", value = "150"] = process.argv.slice(2);

async function main() {
  const connection = mongoose.createConnection(config.mongoUri, { dbName: config.mongoDbName });
  await connection.asPromise();

  const Coupon = getCouponModel(connection);
  const upserted = await Coupon.findOneAndUpdate(
    { code: code.toUpperCase() },
    {
      $setOnInsert: {
        code: code.toUpperCase(),
        type,
        value: Number(value),
        maxRedemptionsTotal: 0, // unlimited, for repeatable manual testing
        validFrom: new Date(Date.now() - 86400000),
        validTo: new Date(Date.now() + 365 * 86400000),
        active: true,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  console.log("seeded coupon:", upserted.toObject());
  await connection.close();
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
