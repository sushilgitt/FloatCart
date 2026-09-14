import { BillingInterval } from "@shopify/shopify-api";

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const FREE_PLAN = "free";
// Monthly plan keeps its original name so existing subscribers are still recognised.
export const PREMIUM_PLAN =
  process.env.SHOPIFY_PREMIUM_PLAN || "premium-plan";
export const PREMIUM_YEARLY_PLAN =
  process.env.SHOPIFY_PREMIUM_YEARLY_PLAN || "premium-plan-yearly";
export const PREMIUM_PLAN_KEY =
  process.env.SHOPIFY_PREMIUM_PLAN_KEY || "floating-cart-button-premium";
export const PREMIUM_PRICE = parseNumber(
  process.env.SHOPIFY_PREMIUM_PRICE,
  30,
);
export const PREMIUM_YEARLY_PRICE = parseNumber(
  process.env.SHOPIFY_PREMIUM_YEARLY_PRICE,
  300,
);
export const PREMIUM_CURRENCY =
  process.env.SHOPIFY_PREMIUM_CURRENCY || "USD";
export const PREMIUM_TRIAL_DAYS = parseNumber(
  process.env.SHOPIFY_PREMIUM_TRIAL_DAYS,
  0,
);
export const IS_TEST =
  String(process.env.SHOPIFY_BILLING_TEST_MODE).toLowerCase() === "true";

// Both billing intervals unlock the same Premium tier.
export const PREMIUM_PLANS = [PREMIUM_PLAN, PREMIUM_YEARLY_PLAN];

// Saving of yearly vs. 12 monthly payments ($300 vs $360 => 17%).
export const PREMIUM_YEARLY_DISCOUNT_PERCENT = Math.max(
  0,
  Math.round((1 - PREMIUM_YEARLY_PRICE / (PREMIUM_PRICE * 12)) * 100),
);

export function planForInterval(interval) {
  return interval === "yearly" ? PREMIUM_YEARLY_PLAN : PREMIUM_PLAN;
}

export function intervalForPlan(planName) {
  return planName === PREMIUM_YEARLY_PLAN ? "yearly" : "monthly";
}

export const billingConfig = {
  [PREMIUM_PLAN]: {
    amount: PREMIUM_PRICE,
    currencyCode: PREMIUM_CURRENCY,
    interval: BillingInterval.Every30Days,
    trialDays: PREMIUM_TRIAL_DAYS,
  },
  [PREMIUM_YEARLY_PLAN]: {
    amount: PREMIUM_YEARLY_PRICE,
    currencyCode: PREMIUM_CURRENCY,
    interval: BillingInterval.Annual,
    trialDays: PREMIUM_TRIAL_DAYS,
  },
};
