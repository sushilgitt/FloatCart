// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import crypto from "crypto";
import express from "express";
import serveStatic from "serve-static";
import { Session } from "@shopify/shopify-api";
import shopify from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import GDPRWebhookHandlers from "./gdpr.js";
import dotenv from "dotenv";
import createDbConnection from "./analytics-db.js";
import { connectToMongoDB } from "./mongodb.js";
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

// Per-shop plan cache. Without it the storefront proxy calls the Admin billing API on
// every pageview (rate-limit + latency, and premium stores flicker to FREE when
// throttled). We cache confirmed checks briefly and invalidate them on the
// app_subscriptions/update webhook so upgrades/cancellations reflect within one pageview.
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;
const planCache = new Map(); // shop -> { tier, expires }

function getCachedPlan(shop) {
  const entry = planCache.get(shop);
  if (entry && entry.expires > Date.now()) return entry.tier;
  if (entry) planCache.delete(shop);
  return null;
}
function setCachedPlan(shop, tier) {
  planCache.set(shop, { tier, expires: Date.now() + PLAN_CACHE_TTL_MS });
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

    // Subscription lifecycle changed (upgrade/cancel/frozen/reactivated): drop the cached
    // plan so the next storefront check re-reads the live billing state.
    if (topic === "APP_SUBSCRIPTIONS_UPDATE" && shop) {
      invalidatePlan(String(shop));
      console.log(`[billing] app_subscriptions/update → invalidated plan cache for ${shop}`);
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

app.get("/api/floating-cart/hasSubscription", async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return res.status(HTTP_STATUS.BAD_REQUEST).send({
        error: "Missing 'shop' parameter",
      });
    }

    // Serve from cache when warm — avoids an Admin billing call on every storefront
    // pageview (and the FREE-flicker that Admin API throttling would otherwise cause).
    const cachedTier = getCachedPlan(String(shop));
    if (cachedTier) {
      return res.status(HTTP_STATUS.OK).send({
        hasActiveSubscription: cachedTier === PREMIUM_PLAN,
        tier: cachedTier,
        cached: true,
      });
    }

    const collection = await connectToMongoDB();
    const session = await collection.findOne({ shop });

    if (!session) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Unauthorized: Session not found",
      });
    }

    // Public storefront context: no App Bridge id_token here, so we cannot re-exchange a
    // stale offline token. On any billing error we degrade to FREE (never 500) and do NOT
    // cache it, so the check retries next pageview once the token self-heals in the admin app.
    let tier;
    try {
      tier = await checkPremium(session);
      setCachedPlan(String(shop), tier);
    } catch (error) {
      console.error("Error checking plan tier:", error?.message || error);
      tier = FREE_PLAN;
    }

    return res.status(HTTP_STATUS.OK).send({
      hasActiveSubscription: tier === PREMIUM_PLAN,
      tier,
    });
  } catch (error) {
    console.error("Error in hasSubscription:", error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to fetch subscription",
    });
  }
});

// Returns the store's active Premium subscription (monthly or yearly), or null.
// Lets errors (e.g. a 401) propagate so withFreshToken can retry on the embedded routes.
async function getPremiumSubscription(session) {
  const { appSubscriptions = [] } = await shopify.api.billing.check({
    session,
    plans: PREMIUM_PLANS,
    isTest: IS_TEST,
    returnObject: true,
  });
  return appSubscriptions[0] || null;
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
// Manual token exchange that requests an EXPIRING offline access token.
// The library's shopify.api.auth.tokenExchange() omits the `expiring=1` flag, so it
// returns the legacy non-expiring token that Shopify now rejects with a 403. Adding
// `expiring=1` yields a token with `expires_in` (+ a refresh_token) that Shopify
// accepts.
async function exchangeForExpiringOfflineToken(shop, sessionToken) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type:
        "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: 1,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Expiring token exchange failed (${response.status}): ${detail.slice(0, 200)}`
    );
  }

  const data = await response.json();
  const session = new Session({
    id: shopify.api.session.getOfflineId(shop),
    shop,
    state: "",
    isOnline: false,
  });
  session.accessToken = data.access_token;
  session.scope = data.scope;
  if (data.expires_in) {
    session.expires = new Date(Date.now() + Number(data.expires_in) * 1000);
  }
  return session;
}

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
    await shopify.config.sessionStorage.storeSession(session);
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
      await shopify.config.sessionStorage.storeSession(fresh);
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

app.get("/api/createSubscription", async (req, res) => {
  try {
    // ?interval=yearly selects the annual plan; anything else is monthly.
    const plan = planForInterval(req.query.interval);
    const interval = intervalForPlan(plan);

    const result = await withFreshToken(res, async (session) => {
      const active = await getPremiumSubscription(session);

      if (active?.name === plan) {
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
      const hasPremium = Boolean(await getPremiumSubscription(session));

      if (!hasPremium) {
        return { status: "No subscription found" };
      }

      const subscriptionStatus = await cancelSubscription(session);
      const client = new shopify.api.clients.Graphql({ session });
      const currentInstallations = await client.request(CURRENT_APP_INSTALLATION, {
        variables: { namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
      });

      const installation = currentInstallations?.data?.currentAppInstallation;
      const ownerId = installation?.id;
      const metafield = installation?.metafield;

      if (ownerId && metafield) {
        const deleteResp = await client.request(APP_OWNED_METAFIELD_DELETE, {
          variables: { ownerId, namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
        });

        const delErrors = deleteResp?.data?.appOwnedMetafieldDelete?.userErrors || [];
        if (delErrors.length) {
          console.error("Failed to delete metafield:", delErrors);
        }
      }

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

      if (!subscription) {
        return { hasActiveSubscription: false, tier: FREE_PLAN };
      }

      const client = new shopify.api.clients.Graphql({ session });
      const currentInstallations = await client.request(CURRENT_APP_INSTALLATION, {
        variables: { namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
      });

      const installation = currentInstallations?.data?.currentAppInstallation;
      const ownerId = installation?.id;
      const existing = installation?.metafield;

      if (!existing && ownerId) {
        const createResp = await client.request(CREATE_APP_DATA_METAFIELD, {
          variables: {
            metafieldsSetInput: [
              {
                namespace: SOLNIX,
                key: PREMIUM_PLAN_KEY,
                type: "boolean",
                value: "true",
                ownerId,
              },
            ],
          },
        });

        const createErrors = createResp?.data?.metafieldsSet?.userErrors || [];
        if (createErrors.length) {
          console.error("Failed to add metafield:", createErrors);
        }
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
