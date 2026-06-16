// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";
import shopify from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import GDPRWebhookHandlers from "./gdpr.js";
import dotenv from "dotenv";
import createDbConnection from "./analytics-db.js";
import { connectToMongoDB } from "./mongodb.js";

dotenv.config();

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

// Shopify auth & webhooks
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
);

// ---- Plans / constants ----
const PREMIUM_PLAN = "MeroxIO Basic";       // your “paid/basic” plan
const UNLIMITED_PLAN = "MeroxIO Premium";    // your “premium/unlimited” plan
const MEROXIO = "meroxio";
const PREMIUM_PLAN_KEY = "floating-cart-button-premium";
const IS_TEST = false;
const APP_NAME = "Floating Cart Button";
const ANALYTICS_DB_PREFIX = "floating_cart_button";
const HTTP_STATUS = { OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, INTERNAL_SERVER_ERROR: 500 };

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

/* -------------------- Subscription Check (MongoDB Session) -------------------- */
app.get("/api/floating-cart/hasSubscription", async (req, res) => {
  try {
    console.log("inside hassubs");
    const { shop } = req.query;

    if (!shop) {
      console.warn("Missing 'shop' parameter in request");
      return res.status(400).send({ error: "Missing 'shop' parameter" });
    }

    console.log(`Request received from shop: ${shop}`);
    const collection = await connectToMongoDB();
    const session = await collection.findOne({ shop });

    if (!session) {
      console.warn(`No session found for shop: ${shop}`);
      return res.status(401).send({ error: "Unauthorized: Session not found" });
    }

    const tier = await getPlanTier(session);
    console.log(`Subscription status for shop ${shop}: ${tier}`);

    return res.status(200).send({
      hasActiveSubscription: tier !== "free",
      tier, // free | premium | unlimited
    });
  } catch (error) {
    console.error("Error in hasSubscription:", error.message);
    return res.status(500).send({ error: "Failed to fetch subscription" });
  }
});

/* ---------------------- Subscription Utilities ---------------------- */
async function getPlanTier(session) {
  try {
    const hasUnlimited = await shopify.api.billing.check({
      session,
      plans: [UNLIMITED_PLAN],
      isTest: IS_TEST,
    });
    if (hasUnlimited) return "unlimited";

    const hasPremium = await shopify.api.billing.check({
      session,
      plans: [PREMIUM_PLAN],
      isTest: IS_TEST,
    });
    if (hasPremium) return "premium";

    return "free";
  } catch (error) {
    console.error("Error checking plan tier:", error);
    return "free";
  }
}

/* ---------------------- Analytics Event Logging ---------------------- */
app.post("/api/meroxio-proxy/:event", async (req, res) => {
  try {
    const { event } = req.params;
    const { merchantId, ...eventData } = req.body;
    if (!merchantId) {
      return res.status(400).send({ error: "Missing 'merchantId'" });
    }

    const db = createDbConnection(ANALYTICS_DB_PREFIX);
    const eventDataString = JSON.stringify(eventData);

    db.run(
      `INSERT INTO ${ANALYTICS_DB_PREFIX}_events (event_type, merchant_id, event_data) VALUES (?, ?, ?)`,
      [event, merchantId, eventDataString],
      function (err) {
        if (err) {
          return res.status(500).send({ error: "Failed to log event" });
        }
        res.status(200).send({ success: true, eventId: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).send({ error: "Failed to handle event" });
  }
});

app.use("/api/*", shopify.validateAuthenticatedSession());

/* ---------------------- Utility Functions ---------------------- */
const handleError = (res, statusCode, message) => {
  console.error(message);
  res.status(statusCode).send({ error: message });
};

async function storeShopDetails(shopDetails) {
  try {
    const response = await fetch(
      "https://app.meroxio.com/app-installation-data-store/storedata",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopDetails),
      }
    );
    if (!response.ok) throw new Error("Network response was not ok.");
    console.log("Shop details stored successfully.");
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

/* --------------------------- Subscription Routes -------------------------- */

// Create / Switch Subscription
app.get("/api/createSubscription", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const planParam = (req.query.plan || "").toString().toLowerCase();
    const planName = planParam === "unlimited" ? UNLIMITED_PLAN : PREMIUM_PLAN;

    const hasPayment = await shopify.api.billing.check({
      session,
      plans: [planName],
      isTest: IS_TEST,
    });

    if (hasPayment) {
      console.log(`✅ ${session.shop} is already subscribed to: ${planName}`);
      res.status(200).send({ isActiveSubscription: true, plan: planName });
    } else {
      console.log(`➡️ ${session.shop} is switching/creating subscription for: ${planName}`);
      const redirectUrl = await shopify.api.billing.request({
        session,
        plan: planName,
        isTest: IS_TEST,
      });
      res.status(200).send({
        isActiveSubscription: false,
        plan: planName,
        confirmationUrl: redirectUrl,
      });
    }
  } catch (error) {
    console.error("❌ Failed to create subscription:", error);
    res.status(500).send({ error: "Failed to create subscription" });
  }
});

// Cancel Subscription
app.get("/api/cancelSubscription", async (req, res) => {
  try {
    const session = res.locals.shopify.session;

    const hasPremium = await shopify.api.billing.check({ session, plans: [PREMIUM_PLAN], isTest: IS_TEST });
    const hasUnlimited = await shopify.api.billing.check({ session, plans: [UNLIMITED_PLAN], isTest: IS_TEST });

    if (hasPremium || hasUnlimited) {
      const planToCancel = hasUnlimited ? UNLIMITED_PLAN : PREMIUM_PLAN;
      console.log(`⚠️ ${session.shop} cancelling plan: ${planToCancel}`);

      const subscriptionStatus = await cancelSubscription(session);
      console.log(`✅ ${session.shop} subscription cancelled. Status: ${subscriptionStatus}`);

      // Remove app-owned metafield if present
      const client = new shopify.api.clients.Graphql({ session });
      const currentInstallations = await client.request(
        CURRENT_APP_INSTALLATION,
        { variables: { namespace: MEROXIO, key: PREMIUM_PLAN_KEY } }
      );

      const installation = currentInstallations?.currentAppInstallation;
      const ownerId = installation?.id;
      const metafield = installation?.metafield;

      if (ownerId && metafield) {
        console.log(`🗑️ Removing appOwnedMetafield for shop: ${session.shop}`);
        const deleteResp = await client.request(
          APP_OWNED_METAFIELD_DELETE,
          { variables: { ownerId, namespace: MEROXIO, key: PREMIUM_PLAN_KEY } }
        );

        const delErrors = deleteResp?.appOwnedMetafieldDelete?.userErrors || [];
        if (delErrors.length) {
          console.error("❌ Failed to delete metafield:", delErrors);
        } else {
          console.log(`✅ Metafield deleted successfully for shop: ${session.shop}`);
        }
      }

      // Downgrade after cancel
      if (["CANCELLED", "ACTIVE_CANCELLED"].includes(subscriptionStatus)) {
        console.log(`⬇️ Downgrading ${session.shop} to FREE plan...`);
        // 👉 Add your downgrade logic here
      }

      return res.status(200).send({ status: subscriptionStatus, cancelledPlan: planToCancel });
    }

    console.log(`ℹ️ ${session.shop} has no active subscription to cancel`);
    res.status(200).send({ status: "No subscription found" });
  } catch (error) {
    console.error("❌ Failed to cancel subscription:", error);
    res.status(500).send({ error: "Failed to cancel subscription" });
  }
});

// Check Active Subscription + ensure premium metafield
app.get("/api/hasActiveSubscription", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    const tier = await getPlanTier(session);
    const hasActive = tier !== "free";

    console.log(`🔎 ${session.shop} subscription check → Current tier: ${tier}`);

    if (!hasActive) {
      return res.status(200).send({ hasActiveSubscription: false });
    }

    const client = new shopify.api.clients.Graphql({ session });
    const currentInstallations = await client.request(
      CURRENT_APP_INSTALLATION,
      { variables: { namespace: MEROXIO, key: PREMIUM_PLAN_KEY } }
    );

    const installation = currentInstallations?.currentAppInstallation;
    const ownerId = installation?.id;
    const existing = installation?.metafield;

    if (!existing && ownerId) {
      console.log(`🆕 Creating metafield for paid plan on shop: ${session.shop}`);
      const createResp = await client.request(
        CREATE_APP_DATA_METAFIELD,
        {
          variables: {
            metafieldsSetInput: [
              { namespace: MEROXIO, key: PREMIUM_PLAN_KEY, type: "boolean", value: "true", ownerId },
            ],
          },
        }
      );

      const createErrors = createResp?.metafieldsSet?.userErrors || [];
      if (createErrors.length) {
        console.error("❌ Failed to add metafield:", createErrors);
      } else {
        console.log(`✅ Metafield created for shop: ${session.shop}`);
      }
    }

    res.status(200).send({ hasActiveSubscription: true, tier });
  } catch (error) {
    console.error("❌ Failed to fetch subscription:", error);
    res.status(500).send({ error: "Failed to fetch subscription" });
  }
});


/* --------------------------- Helper for Plan Info --------------------------- */
function getOrderLimit(planTier) {
  switch (planTier) {
    case "unlimited":
      return Number.MAX_SAFE_INTEGER;
    case "premium":
      return 1000;
    default:
      return 100;
  }
}

async function getStoreId(session) {
  return session.shop || "unknown_store";
}

async function getCurrentOrderCount(storeId) {
  console.log(`Fetching current order count for store: ${storeId}`);
  return 0; // replace with real count if needed
}

app.get("/api/meroxio-proxy/plan-info", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    const storeId = await getStoreId(session);

    const planTier = await getPlanTier(session);
    const orderLimit = getOrderLimit(planTier);
    const currentCount = await getCurrentOrderCount(storeId);
    const remaining = Math.max(0, orderLimit - currentCount);

    res.status(200).json({
      planTier,
      orderLimit,
      currentCount,
      remaining,
      canImportMore: remaining > 0,
    });
  } catch (error) {
    console.error("Failed to get plan info:", error);
    res.status(500).json({ error: "Failed to get plan information" });
  }
});

/* --------------------------- Misc APIs --------------------------- */
app.get("/api/getshop", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopName = session ? session.shop : "Shop name not found";
    res.json({ shop: shopName });
  } catch (err) {
    console.error("Error fetching shop:", err);
    res.status(500).json({ error: "Failed to fetch shop" });
  }
});

app.get("/api/store-details", async (_req, res) => {
  const session = res.locals.shopify.session;
  if (!session) return handleError(res, HTTP_STATUS.UNAUTHORIZED, "No active session found.");
  try {
    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(shopDetailsQuery);
    const shopData = (response?.shop ?? response?.data?.shop ?? response?.data) || {};
    const { name, email, primaryDomain, plan } = shopData;

    await storeShopDetails({
      appName: APP_NAME,
      storeUrl: primaryDomain?.url,
      name,
      email,
      plan: plan?.displayName,
    });

    res.status(HTTP_STATUS.OK).send({
      message: "Shop details fetched successfully",
      data: { name, email, primaryDomain, plan },
    });
  } catch (error) {
    handleError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      `Failed to fetch store details: ${error.message}`
    );
  }
});

/* --------------------------- Serve Frontend --------------------------- */
app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () => console.log(`🚀 Server running  on http://localhost:${PORT}`));

/* --------------------------- GraphQL Queries --------------------------- */

// Read app-owned metafield on the app installation
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

// Create/Update app-owned metafield
const CREATE_APP_DATA_METAFIELD = `
  mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafieldsSetInput) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`;

// Delete app-owned metafield (correct for app-owned metafields)
const APP_OWNED_METAFIELD_DELETE = `
  mutation appOwnedMetafieldDelete($ownerId: ID!, $namespace: String!, $key: String!) {
    appOwnedMetafieldDelete(ownerId: $ownerId, namespace: $namespace, key: $key) {
      deletedId
      userErrors { field message }
    }
  }
`;
