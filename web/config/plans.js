import { BillingInterval } from "@shopify/shopify-api";

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const FREE_PLAN = "free";
export const PREMIUM_PLAN =
  process.env.SHOPIFY_PREMIUM_PLAN || "premium-plan";
export const PREMIUM_PLAN_KEY =
  process.env.SHOPIFY_PREMIUM_PLAN_KEY || "floating-cart-button-premium";
export const PREMIUM_PRICE = parseNumber(
  process.env.SHOPIFY_PREMIUM_PRICE,
  30,
);
export const PREMIUM_CURRENCY =
  process.env.SHOPIFY_PREMIUM_CURRENCY || "USD";
export const PREMIUM_TRIAL_DAYS = parseNumber(
  process.env.SHOPIFY_PREMIUM_TRIAL_DAYS,
  0,
);
export const IS_TEST =
  String(process.env.SHOPIFY_BILLING_TEST_MODE).toLowerCase() === "true";

export const billingConfig = {
  [PREMIUM_PLAN]: {
    amount: PREMIUM_PRICE,
    currencyCode: PREMIUM_CURRENCY,
    interval: BillingInterval.Every30Days,
    trialDays: PREMIUM_TRIAL_DAYS,
  },
};
