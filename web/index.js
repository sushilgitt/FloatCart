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
  PREMIUM_PLAN_KEY,
  IS_TEST,
} from "./config/plans.js";

dotenv.config();

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

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

    const collection = await connectToMongoDB();
    const session = await collection.findOne({ shop });

    if (!session) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).send({
        error: "Unauthorized: Session not found",
      });
    }

    const tier = await getPlanTier(session);

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

async function getPlanTier(session) {
  try {
    const hasPremium = await shopify.api.billing.check({
      session,
      plans: [PREMIUM_PLAN],
      isTest: IS_TEST,
    });

    return hasPremium ? PREMIUM_PLAN : FREE_PLAN;
  } catch (error) {
    console.error("Error checking plan tier:", error);
    return FREE_PLAN;
  }
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

  res.locals.shopify = { ...res.locals.shopify, session };
  return next();
}

app.use("/api/*", wrapAsync(authViaTokenExchange));

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

app.get("/api/createSubscription", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;

    const hasPayment = await shopify.api.billing.check({
      session,
      plans: [PREMIUM_PLAN],
      isTest: IS_TEST,
    });

    if (hasPayment) {
      return res.status(HTTP_STATUS.OK).send({
        isActiveSubscription: true,
        plan: PREMIUM_PLAN,
      });
    }

    const confirmationUrl = await shopify.api.billing.request({
      session,
      plan: PREMIUM_PLAN,
      isTest: IS_TEST,
    });

    return res.status(HTTP_STATUS.OK).send({
      isActiveSubscription: false,
      plan: PREMIUM_PLAN,
      confirmationUrl,
    });
  } catch (error) {
    console.error("Failed to create subscription:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to create subscription",
    });
  }
});

app.get("/api/cancelSubscription", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;

    const hasPremium = await shopify.api.billing.check({
      session,
      plans: [PREMIUM_PLAN],
      isTest: IS_TEST,
    });

    if (!hasPremium) {
      return res.status(HTTP_STATUS.OK).send({
        status: "No subscription found",
      });
    }

    const subscriptionStatus = await cancelSubscription(session);
    const client = new shopify.api.clients.Graphql({ session });
    const currentInstallations = await client.request(CURRENT_APP_INSTALLATION, {
      variables: { namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
    });

    const installation = currentInstallations?.currentAppInstallation;
    const ownerId = installation?.id;
    const metafield = installation?.metafield;

    if (ownerId && metafield) {
      const deleteResp = await client.request(APP_OWNED_METAFIELD_DELETE, {
        variables: { ownerId, namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
      });

      const delErrors = deleteResp?.appOwnedMetafieldDelete?.userErrors || [];
      if (delErrors.length) {
        console.error("Failed to delete metafield:", delErrors);
      }
    }

    return res.status(HTTP_STATUS.OK).send({
      status: subscriptionStatus,
      cancelledPlan: PREMIUM_PLAN,
    });
  } catch (error) {
    console.error("Failed to cancel subscription:", error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
      error: "Failed to cancel subscription",
    });
  }
});

app.get("/api/hasActiveSubscription", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    const tier = await getPlanTier(session);
    const hasActive = tier === PREMIUM_PLAN;

    if (!hasActive) {
      return res.status(HTTP_STATUS.OK).send({
        hasActiveSubscription: false,
        tier: FREE_PLAN,
      });
    }

    const client = new shopify.api.clients.Graphql({ session });
    const currentInstallations = await client.request(CURRENT_APP_INSTALLATION, {
      variables: { namespace: SOLNIX, key: PREMIUM_PLAN_KEY },
    });

    const installation = currentInstallations?.currentAppInstallation;
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

      const createErrors = createResp?.metafieldsSet?.userErrors || [];
      if (createErrors.length) {
        console.error("Failed to add metafield:", createErrors);
      }
    }

    return res.status(HTTP_STATUS.OK).send({
      hasActiveSubscription: true,
      tier,
    });
  } catch (error) {
    console.error("Failed to fetch subscription:", error);
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
    const planTier = await getPlanTier(session);
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
    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(shopDetailsQuery);
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
