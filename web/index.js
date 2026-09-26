// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import crypto from "crypto";
import express from "express";
import serveStatic from "serve-static";
import shopify from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import GDPRWebhookHandlers from "./gdpr.js";
import dotenv from "dotenv";
import createDbConnection from "./analytics-db.js";
import {
  exchangeForExpiringOfflineToken,
  getOfflineSession,
  deleteShopTokens,
} from "./offline-token.js";
import {
  getShopPlan,
  saveVerifiedPlan,
  applySubscriptionWebhook,
  deleteShopPlan,
} from "./plan-store.js";
import {
  FREE_PLAN,
  PREMIUM_PLAN,
  PREMIUM_PLANS,
  PREMIUM_PLAN_KEY,
  PREMIUM_PRICE,
  PREMIUM_YEARLY_PLAN,
  PREMIUM_YEARLY_PRICE,
  PREMIUM_YEARLY_DISCOUNT_PERCENT,
  PREMIUM_CURRENCY,
  IS_TEST,
  planForInterval,
  intervalForPlan,
} from "./config/plans.js";

dotenv.config();

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

// Billing mode is LIVE unless SHOPIFY_BILLING_TEST_MODE=true. Log it on boot so a
// misconfigured non-prod store (which would otherwise create REAL charges) is obvious.
console.log(
  `[billing] mode: ${IS_TEST ? "TEST" : "LIVE"} — set SHOPIFY_BILLING_TEST_MODE=true for test charges`
);

// Storefront plan lookup is layered so a pageview almost never touches the Admin API:
//   1. in-process cache (PLAN_CACHE_TTL_MS)
//   2. the shop_plans record in Mongo (kept current by the admin app and the
//      app_subscriptions/update webhook), trusted for PLAN_RECORD_MAX_AGE_MS
//   3. a live billing check with the offline token (refreshed if expired)
// A failed live check falls back to the last known record rather than FREE, so a
// token or API hiccup never strips Premium from a paying store.
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAN_ERROR_CACHE_TTL_MS = 60 * 1000;
const PLAN_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const planCache = new Map(); // shop -> { tier, expires }

function getCachedPlan(shop) {
  const entry = planCache.get(shop);
  if (entry && entry.expires > Date.now()) return entry.tier;
  if (entry) planCache.delete(shop);
  return null;
}
function setCachedPlan(shop, tier, ttl = PLAN_CACHE_TTL_MS) {
  planCache.set(shop, { tier, expires: Date.now() + ttl });
}
function invalidatePlan(shop) {
  planCache.delete(shop);
}

const app = express();

app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  async (req, res, next) => {
    try {
      const { session } = await shopify.api.auth.callback({
        rawRequest: req,
        rawResponse: res,
      });
      await shopify.config.sessionStorage.storeSession(session);
      // This app has no application webhooks. Its only webhooks are the mandatory
      // compliance topics, declared in shopify.app.toml and registered by Shopify
      // automatically. We intentionally skip shopify.api.webhooks.register() — it
      // runs an Admin GraphQL query that can return 403 and abort OAuth (500).
      res.locals.shopify = { ...res.locals.shopify, session };
      return next();
    } catch (err) {
      console.error("OAuth callback failed:", err);
      const shop = req.query.shop;
      if (shop) {
        return res.redirect(`/api/auth?shop=${encodeURIComponent(String(shop))}`);
      }
      return res.status(500).send("OAuth callback failed");
    }
  },
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  "/api/webhooks",
  express.text({ type: "*/*" }),
  async (req, res) => {
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    if (!hmacHeader) return res.status(400).send();

    const generatedHash = crypto
      .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
      .update(req.body, "utf8")
      .digest("base64");

    let valid = false;
    try {
      valid = crypto.timingSafeEqual(
        Buffer.from(generatedHash, "base64"),
        Buffer.from(hmacHeader, "base64")
      );
    } catch {
      return res.status(400).send();
    }

    if (!valid) return res.status(401).send();

    res.status(200).send();

    const topic = String(req.headers["x-shopify-topic"] ?? "")
      .toUpperCase().replace(/\//g, "_");
    const shop = req.headers["x-shopify-shop-domain"];
    const webhookId = req.headers["x-shopify-webhook-id"];

    // Subscription lifecycle changed (upgrade/cancel/frozen/reactivated): record the new
    // state so the storefront reflects it on the next pageview without an Admin call.
    if (topic === "APP_SUBSCRIPTIONS_UPDATE" && shop) {
      const shopDomain = String(shop);
      invalidatePlan(shopDomain);
      try {
        const tier = await applySubscriptionWebhook(shopDomain, JSON.parse(req.body));
        if (tier) setCachedPlan(shopDomain, tier);
        console.log(
          `[billing] app_subscriptions/update for ${shopDomain} → ${tier ?? "no change"}`
        );
      } catch (err) {
        console.error("[billing] app_subscriptions/update handling failed:", err);
      }
    }

    // Uninstall cancels the subscription; shop/redact is the GDPR request to erase the
    // shop's data. Either way drop its plan record and tokens so a reinstall starts clean.
    if ((topic === "APP_UNINSTALLED" || topic === "SHOP_REDACT") && shop) {
      const shopDomain = String(shop);
      invalidatePlan(shopDomain);
      try {
        await Promise.all([deleteShopPlan(shopDomain), deleteShopTokens(shopDomain)]);
        console.log(`[webhook] ${topic}: removed plan + tokens for ${shopDomain}`);
      } catch (err) {
        console.error(`[webhook] ${topic} cleanup failed:`, err);
      }
    }

    const handler = GDPRWebhookHandlers[topic];
    if (handler?.callback) {
      handler.callback(topic, shop, req.body, webhookId)
        .catch(err => console.error(`[Webhook] ${topic} handler error:`, err));
    }
  }
);

const SOLNIX = "solnix";
const APP_NAME = "FloatCart";
const ANALYTICS_DB_PREFIX = "floating_cart_button";
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INTERNAL_SERVER_ERROR: 500,
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve the shop from a request that came through the Shopify app proxy. The proxy
// signs its query string, so a valid signature proves the request came from Shopify
// for that shop; without this anyone could query (and burn Admin API calls for) any shop.
async function shopFromAppProxy(query) {
  try {
    const valid = await shopify.api.utils.validateHmac(query, {
      signator: "appProxy",
    });
    if (!valid) return null;
  } catch {
    return null; // missing signature or stale timestamp
  }
  // Older extension builds also append ?shop=, so it can arrive as an array.
  const shop = Array.isArray(query.shop) ? query.shop[0] : query.shop;
  return shopify.api.utils.sanitizeShop(String(shop || "")) || null;
}

// Live billing check with the stored offline token, refreshing it when expired and
// once more if Shopify rejects it anyway.
async function verifyPlanWithAdmin(shop) {
  let session = await getOfflineSession(shop);
  if (!session) throw new Error(`No offline session for ${shop}`);

  let subscription;
  try {
    subscription = await getPremiumSubscription(session);
  } catch (err) {
    const code = err?.response?.code;
    if (code !== 401 && code !== 403) throw err;
    session = await getOfflineSession(shop, { force: true });
    subscription = await getPremiumSubscription(session);
  }

  await saveVerifiedPlan(shop, subscription);
  return subscription ? PREMIUM_PLAN : FREE_PLAN;
}

async function resolveStorefrontPlan(shop) {
  const cached = getCachedPlan(shop);
  if (cached) return { tier: cached, source: "cache" };

  const record = await getShopPlan(shop).catch((err) => {
    console.error("[billing] plan record read failed:", err?.message || err);
    return null;
  });
  // updatedAt moves on every verification AND every subscription webhook. Past the max
  // age we re-verify, which catches a missed webhook (e.g. cancelled while uninstalled).
  const recordAge = record?.updatedAt
    ? Date.now() - new Date(record.updatedAt).getTime()
    : Infinity;
  if (record && recordAge < PLAN_RECORD_MAX_AGE_MS) {
    setCachedPlan(shop, record.tier);
    return { tier: record.tier, source: "record" };
  }

  try {
    const tier = await verifyPlanWithAdmin(shop);
    setCachedPlan(shop, tier);
    return { tier, source: "admin" };
  } catch (err) {
    console.error(`[billing] live plan check failed for ${shop}:`, err?.message || err);
    // Prefer the last known plan over FREE; cache briefly so a broken token does not
    // turn every pageview into a failing Admin API call.
    const tier = record?.tier || FREE_PLAN;
    setCachedPlan(shop, tier, PLAN_ERROR_CACHE_TTL_MS);
    return { tier, source: record ? "stale-record" : "fallback" };
  }
}

app.get("/api/floating-cart/hasSubscription", async (req, res) => {
  try {
    const shop = await shopFromAppProxy(req.query);

    if (!shop) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Invalid app proxy request",
      });
    }

    const { tier, source } = await resolveStorefrontPlan(shop);

    return res.status(HTTP_STATUS.OK).send({
      hasActiveSubscription: tier === PREMIUM_PLAN,
      tier,
      source,
    });
  } catch (error) {
    console.error("Error in hasSubscription:", error?.message || error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to fetch subscription",
    });
  }
});

// Returns the store's active Premium subscriptions (monthly and/or yearly).
// Lets errors (e.g. a 401) propagate so withFreshToken can retry on the embedded routes.
async function getPremiumSubscriptions(session) {
  const { appSubscriptions = [] } = await shopify.api.billing.check({
    session,
    plans: PREMIUM_PLANS,
    isTest: IS_TEST,
    returnObject: true,
  });
  return appSubscriptions;
}

async function getPremiumSubscription(session) {
  return (await getPremiumSubscriptions(session))[0] || null;
}

async function checkPremium(session) {
  return (await getPremiumSubscription(session)) ? PREMIUM_PLAN : FREE_PLAN;
}

app.post("/api/solnix-proxy/:event", async (req, res) => {
  try {
    const { event } = req.params;
    const { merchantId, ...eventData } = req.body;

    if (!merchantId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).send({
        error: "Missing 'merchantId'",
      });
    }

    const db = createDbConnection(ANALYTICS_DB_PREFIX);
    const eventDataString = JSON.stringify(eventData);

    db.run(
      `INSERT INTO ${ANALYTICS_DB_PREFIX}_events (event_type, merchant_id, event_data) VALUES (?, ?, ?)`,
      [event, merchantId, eventDataString],
      function (err) {
        if (err) {
          return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
            error: "Failed to log event",
          });
        }

        res.status(HTTP_STATUS.OK).send({
          success: true,
          eventId: this.lastID,
        });
      }
    );
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to handle event",
    });
  }
});

// Express 4 does not catch async-middleware rejections; without this wrapper a
// Shopify API error (e.g. a 403 from hasValidAccessToken) becomes an unhandled
// rejection that crashes the whole process. Route it to the error handler instead.
const wrapAsync = (mw) => (req, res, next) =>
  Promise.resolve(mw(req, res, next)).catch(next);

// Embedded-app auth via token exchange.
// Shopify no longer accepts the legacy NON-EXPIRING offline tokens that the OAuth
// authorization-code grant produced, so every Admin API call with the stored token
// returned a 403 ("Non-expiring access tokens are no longer accepted"). Instead we
// exchange the App Bridge session token (sent as a Bearer header on every
// authenticated fetch) for a fresh, EXPIRING offline access token, caching it until
// it nears expiry. No reinstall needed — this uses the existing install grant.
// See exchangeForExpiringOfflineToken in offline-token.js (also stores the refresh token).
async function authViaTokenExchange(req, res, next) {
  const bearer = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!bearer) {
    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .send({ error: "Missing session token" });
  }

  let shop;
  const sessionToken = bearer[1];
  try {
    const payload = await shopify.api.session.decodeSessionToken(sessionToken);
    shop = shopify.api.utils.sanitizeShop(
      String(payload.dest || "").replace(/^https?:\/\//, ""),
      true
    );
  } catch (error) {
    console.error("[auth] invalid session token:", error?.message || error);
    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .send({ error: "Invalid session token" });
  }

  const offlineId = shopify.api.session.getOfflineId(shop);
  let session = await shopify.config.sessionStorage.loadSession(offlineId);

  const stillValid =
    session?.accessToken &&
    session.expires &&
    new Date(session.expires).getTime() > Date.now() + 60_000;

  if (!stillValid) {
    session = await exchangeForExpiringOfflineToken(shop, sessionToken);
  }

  res.locals.shopify = { ...res.locals.shopify, session, shop, sessionToken };
  return next();
}

// Run an Admin-API operation with self-healing auth. The cached offline token can be
// invalidated by Shopify (rotation/reinstall/scope change) BEFORE its locally stored
// `expires`, so the fast-path cache in authViaTokenExchange may hand us a token Shopify
// rejects with 401/403. When that happens we force ONE fresh token exchange (bypassing the
// cache), persist it, and retry the operation exactly once. `op` receives the session to use.
async function withFreshToken(res, op) {
  try {
    return await op(res.locals.shopify.session);
  } catch (err) {
    const code = err?.response?.code;
    if (code !== 401 && code !== 403) throw err;

    const { shop, sessionToken } = res.locals.shopify || {};
    // The public storefront proxy has no id_token to exchange — cannot self-heal here.
    if (!shop || !sessionToken) throw err;

    let fresh;
    try {
      fresh = await exchangeForExpiringOfflineToken(shop, sessionToken);
      res.locals.shopify.session = fresh;
    } catch (exchangeErr) {
      // Re-exchange itself failed (e.g. bad credentials / not installed) — surface clearly.
      exchangeErr.code = "ADMIN_AUTH_FAILED";
      throw exchangeErr;
    }

    // Retry once, outside the catch so a second failure cannot loop.
    try {
      return await op(fresh);
    } catch (retryErr) {
      // A fresh token still rejected => credentials/install problem, not stale cache.
      retryErr.code = "ADMIN_AUTH_FAILED";
      throw retryErr;
    }
  }
}

// True when an error is an Admin-API authentication failure (after any retry).
const isAuthFailure = (error) =>
  error?.code === "ADMIN_AUTH_FAILED" ||
  error?.response?.code === 401 ||
  error?.response?.code === 403;

app.use("/api/*", wrapAsync(authViaTokenExchange));

// Lightweight plan config for the admin UI so the displayed prices always match the
// actual billing charges. No Admin API call.
app.get("/api/plan-config", (_req, res) => {
  return res.status(HTTP_STATUS.OK).json({
    premiumPlan: PREMIUM_PLAN,
    price: PREMIUM_PRICE,
    currency: PREMIUM_CURRENCY,
    monthly: { plan: PREMIUM_PLAN, price: PREMIUM_PRICE },
    yearly: {
      plan: PREMIUM_YEARLY_PLAN,
      price: PREMIUM_YEARLY_PRICE,
      discountPercent: PREMIUM_YEARLY_DISCOUNT_PERCENT,
    },
  });
});

const handleError = (res, statusCode, message) => {
  console.error(message);
  res.status(statusCode).send({ error: message });
};

async function storeShopDetails(shopDetails) {
  try {
    const response = await fetch("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shopDetails),
    });

    if (!response.ok) {
      throw new Error("Network response was not ok.");
    }
  } catch (error) {
    console.error("Failed to store shop details:", error.message);
  }
}

const shopDetailsQuery = `
{
  shop {
    name
    email
    primaryDomain { url host }
    plan { displayName }
  }
}`;

// Keep the app-owned premium metafield in step with billing: set it while Premium is
// active, delete it otherwise (previously it was only ever deleted by the in-app cancel,
// so a cancellation from Shopify admin or a frozen store left it "true" forever).
async function syncPremiumMetafield(session, isPremium) {
  const client = new shopify.api.clients.Graphql({ session });
  const resp = await client.request(CURRENT_APP_INSTALLATION, {
    variables: { namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
  });
  const installation = resp?.data?.currentAppInstallation;
  const ownerId = installation?.id;
  const existing = installation?.metafield;
  if (!ownerId) return;

  if (isPremium && existing?.value !== "true") {
    const setResp = await client.request(CREATE_APP_DATA_METAFIELD, {
      variables: {
        metafieldsSetInput: [
          { namespace: SOLNIX, key: PREMIUM_PLAN_KEY, type: "boolean", value: "true", ownerId },
        ],
      },
    });
    const errors = setResp?.data?.metafieldsSet?.userErrors || [];
    if (errors.length) console.error("Failed to set premium metafield:", errors);
  } else if (!isPremium && existing) {
    const delResp = await client.request(APP_OWNED_METAFIELD_DELETE, {
      variables: { ownerId, namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
    });
    const errors = delResp?.data?.appOwnedMetafieldDelete?.userErrors || [];
    if (errors.length) console.error("Failed to delete premium metafield:", errors);
  }
}

// Persist a plan the admin just confirmed with Shopify, so the storefront picks it up
// immediately (cache + Mongo record) and the metafield matches. Bookkeeping failures
// are logged, never surfaced: the billing answer itself is already correct.
async function recordPlan(session, subscription) {
  const shop = session.shop;
  setCachedPlan(shop, subscription ? PREMIUM_PLAN : FREE_PLAN);
  await Promise.all([
    saveVerifiedPlan(shop, subscription).catch((err) =>
      console.error("[billing] saving plan record failed:", err?.message || err)
    ),
    syncPremiumMetafield(session, Boolean(subscription)).catch((err) =>
      console.error("[billing] metafield sync failed:", err?.message || err)
    ),
  ]);
}

app.get("/api/createSubscription", async (req, res) => {
  try {
    // ?interval=yearly selects the annual plan; anything else is monthly.
    const plan = planForInterval(req.query.interval);
    const interval = intervalForPlan(plan);

    const result = await withFreshToken(res, async (session) => {
      const active = await getPremiumSubscriptions(session);

      if (active.some((sub) => sub.name === plan)) {
        return { isActiveSubscription: true, plan, interval };
      }

      // Switching monthly <-> yearly needs no separate cancel: Shopify replaces the
      // current subscription once the merchant approves the new charge.
      const confirmationUrl = await shopify.api.billing.request({
        session,
        plan,
        isTest: IS_TEST,
      });

      return { isActiveSubscription: false, plan, interval, confirmationUrl };
    });

    return res.status(HTTP_STATUS.OK).send(result);
  } catch (error) {
    console.error("Failed to create subscription:", error);
    if (isAuthFailure(error)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Admin authentication failed; please reopen the app to re-authenticate.",
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to create subscription",
    });
  }
});

app.get("/api/cancelSubscription", async (_req, res) => {
  try {
    const result = await withFreshToken(res, async (session) => {
      const subscriptions = await getPremiumSubscriptions(session);

      if (!subscriptions.length) {
        await recordPlan(session, null);
        return { status: "No subscription found" };
      }

      // Cancel only Premium subscriptions (normally exactly one), by id.
      let subscriptionStatus;
      for (const sub of subscriptions) {
        subscriptionStatus = await cancelSubscription(session, sub.id);
      }
      await recordPlan(session, null);

      return { status: subscriptionStatus, cancelledPlan: PREMIUM_PLAN };
    });

    return res.status(HTTP_STATUS.OK).send(result);
  } catch (error) {
    console.error("Failed to cancel subscription:", error);
    if (isAuthFailure(error)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Admin authentication failed; please reopen the app to re-authenticate.",
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to cancel subscription",
    });
  }
});

app.get("/api/hasActiveSubscription", async (_req, res) => {
  try {
    const result = await withFreshToken(res, async (session) => {
      const subscription = await getPremiumSubscription(session);
      await recordPlan(session, subscription);

      if (!subscription) {
        return { hasActiveSubscription: false, tier: FREE_PLAN };
      }

      return {
        hasActiveSubscription: true,
        tier: PREMIUM_PLAN,
        interval: intervalForPlan(subscription.name),
      };
    });

    return res.status(HTTP_STATUS.OK).send(result);
  } catch (error) {
    console.error("Failed to fetch subscription:", error);
    if (isAuthFailure(error)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Admin authentication failed; please reopen the app to re-authenticate.",
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to fetch subscription",
    });
  }
});

function getOrderLimit(planTier) {
  return planTier === PREMIUM_PLAN ? Number.MAX_SAFE_INTEGER : 100;
}

async function getStoreId(session) {
  return session.shop || "unknown_store";
}

async function getCurrentOrderCount(storeId) {
  console.log(`Fetching current order count for store: ${storeId}`);
  return 0;
}

app.get("/api/solnix-proxy/plan-info", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    const storeId = await getStoreId(session);
    const planTier = await withFreshToken(res, (s) => checkPremium(s));
    const orderLimit = getOrderLimit(planTier);
    const currentCount = await getCurrentOrderCount(storeId);
    const remaining = Math.max(0, orderLimit - currentCount);

    return res.status(HTTP_STATUS.OK).json({
      planTier,
      orderLimit,
      currentCount,
      remaining,
      canImportMore: remaining > 0,
    });
  } catch (error) {
    console.error("Failed to get plan info:", error);
    if (isAuthFailure(error)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: "Admin authentication failed; please reopen the app to re-authenticate.",
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Failed to get plan information",
    });
  }
});

app.get("/api/getshop", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopName = session ? session.shop : "Shop name not found";
    res.json({ shop: shopName });
  } catch (err) {
    console.error("Error fetching shop:", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Failed to fetch shop",
    });
  }
});

app.get("/api/store-details", async (_req, res) => {
  const session = res.locals.shopify.session;
  if (!session) {
    return handleError(
      res,
      HTTP_STATUS.UNAUTHORIZED,
      "No active session found."
    );
  }

  try {
    const response = await withFreshToken(res, (s) =>
      new shopify.api.clients.Graphql({ session: s }).request(shopDetailsQuery)
    );
    const shopData = response?.shop ?? response?.data?.shop ?? response?.data ?? {};
    const { name, email, primaryDomain, plan } = shopData;

    await storeShopDetails({
      appName: APP_NAME,
      storeUrl: primaryDomain?.url,
      name,
      email,
      plan: plan?.displayName,
    });

    return res.status(HTTP_STATUS.OK).send({
      message: "Shop details fetched successfully",
      data: { name, email, primaryDomain, plan },
    });
  } catch (error) {
    return handleError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      `Failed to fetch store details: ${error.message}`
    );
  }
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));
app.use("/*", async (_req, res) => {
  return res
    .status(HTTP_STATUS.OK)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

// Last line of defense: turn any async throw that reached Express (e.g. a Shopify
// 403 in the auth middleware) into a clean response instead of an unhandled
// rejection that would crash the process.
app.use((err, _req, res, _next) => {
  console.error("[express-error]", err?.message || err);
  if (err?.response) {
    console.error(
      "[express-error-detail]",
      JSON.stringify({
        code: err.response.code,
        statusText: err.response.statusText,
        body: err.response.body,
        headers: err.response.headers,
      })
    );
  }
  if (res.headersSent) return;
  res
    .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    .send({ error: "Request failed" });
});

// Keep the server alive if anything still slips through outside the request cycle.
process.on("unhandledRejection", (reason) =>
  console.error("[unhandledRejection]", reason)
);
process.on("uncaughtException", (err) =>
  console.error("[uncaughtException]", err)
);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

const CURRENT_APP_INSTALLATION = `
  query appSubscription($namespace: String!, $key: String!) {
    currentAppInstallation {
      id
      metafield(namespace: $namespace, key: $key) {
        namespace
        key
        value
        id
      }
    }
  }
`;

const CREATE_APP_DATA_METAFIELD = `
  mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafieldsSetInput) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`;

const APP_OWNED_METAFIELD_DELETE = `
  mutation appOwnedMetafieldDelete($ownerId: ID!, $namespace: String!, $key: String!) {
    appOwnedMetafieldDelete(ownerId: $ownerId, namespace: $namespace, key: $key) {
      deletedId
      userErrors { field message }
    }
  }
`;
