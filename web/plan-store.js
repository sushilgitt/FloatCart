import { getDb } from "./mongodb.js";
import { FREE_PLAN, PREMIUM_PLAN, PREMIUM_PLANS } from "./config/plans.js";

// Last known plan per shop. The storefront reads this instead of calling the Admin
// billing API on every pageview. It is written whenever the plan is verified against
// Shopify (admin app load, storefront re-verification) and on app_subscriptions/update.
const COLLECTION = "shop_plans";

const plans = async () => (await getDb()).collection(COLLECTION);

export async function getShopPlan(shop) {
  return (await plans()).findOne({ shop });
}

// Record a plan confirmed by the Admin API. `subscription` is the active Premium
// AppSubscription (or null for Free).
export async function saveVerifiedPlan(shop, subscription) {
  const now = new Date();
  await (await plans()).updateOne(
    { shop },
    {
      $set: {
        shop,
        tier: subscription ? PREMIUM_PLAN : FREE_PLAN,
        subscriptionId: subscription?.id || null,
        planName: subscription?.name || null,
        status: subscription?.status || null,
        verifiedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

// Apply an app_subscriptions/update webhook. Returns the new tier, or null when the
// webhook did not change what we know (so the caller should just drop its cache).
export async function applySubscriptionWebhook(shop, body) {
  const sub = body?.app_subscription;
  if (!sub || !PREMIUM_PLANS.includes(sub.name)) return null;

  const id = sub.admin_graphql_api_id;
  const status = String(sub.status || "").toUpperCase();
  const collection = await plans();
  const now = new Date();

  if (status === "ACTIVE") {
    await collection.updateOne(
      { shop },
      {
        $set: {
          shop,
          tier: PREMIUM_PLAN,
          subscriptionId: id,
          planName: sub.name,
          status,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    return PREMIUM_PLAN;
  }

  // Only downgrade when the subscription that ended is the one we believe is active.
  // Switching monthly <-> yearly sends ACTIVE (new) and CANCELLED (old) in either
  // order; a DECLINED/PENDING upgrade attempt must not cancel an existing Premium.
  const result = await collection.updateOne(
    { shop, subscriptionId: id },
    { $set: { tier: FREE_PLAN, subscriptionId: null, status, updatedAt: now } }
  );
  return result.modifiedCount ? FREE_PLAN : null;
}

export async function deleteShopPlan(shop) {
  await (await plans()).deleteMany({ shop });
}
