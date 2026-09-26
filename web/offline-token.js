import { Session } from "@shopify/shopify-api";
import shopify from "./shopify.js";
import { getDb } from "./mongodb.js";

// Expiring offline tokens live ~1 hour. The admin app can always mint a new one from
// the App Bridge id_token, but the public storefront proxy cannot — it has to use the
// refresh_token. Session.toObject() (used by the session storage) drops refresh
// tokens, so we keep them in their own collection, keyed by shop.
const REFRESH_COLLECTION = "shop_refresh_tokens";

// Refresh tokens rotate on every use, so two concurrent refreshes for the same shop
// would invalidate each other. Share one in-flight refresh per shop.
const inflightRefresh = new Map(); // shop -> Promise<Session>

const refreshCollection = async () =>
  (await getDb()).collection(REFRESH_COLLECTION);

function sessionFromTokenResponse(shop, data) {
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

async function requestToken(shop, body) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      ...body,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `Token request (${body.grant_type}) failed (${response.status}): ${detail.slice(0, 200)}`
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Persist the offline session plus its refresh token (when the response carries one).
async function persist(shop, data, session) {
  await shopify.config.sessionStorage.storeSession(session);

  if (data.refresh_token) {
    const refreshTokenExpires = data.refresh_token_expires_in
      ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000)
      : null;
    await (await refreshCollection()).updateOne(
      { shop },
      {
        $set: {
          shop,
          refreshToken: data.refresh_token,
          refreshTokenExpires,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

// Manual token exchange that requests an EXPIRING offline access token.
// The library's shopify.api.auth.tokenExchange() omits the `expiring=1` flag, so it
// returns the legacy non-expiring token that Shopify now rejects with a 403. Adding
// `expiring=1` yields a token with `expires_in` (+ a refresh_token) that Shopify
// accepts.
export async function exchangeForExpiringOfflineToken(shop, sessionToken) {
  const data = await requestToken(shop, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: 1,
  });
  const session = sessionFromTokenResponse(shop, data);
  await persist(shop, data, session);
  return session;
}

async function refreshOfflineToken(shop) {
  const record = await (await refreshCollection()).findOne({ shop });
  if (!record?.refreshToken) {
    throw new Error(`No refresh token stored for ${shop}`);
  }
  if (record.refreshTokenExpires && new Date(record.refreshTokenExpires) <= new Date()) {
    throw new Error(`Refresh token expired for ${shop}`);
  }

  const data = await requestToken(shop, {
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
  });
  const session = sessionFromTokenResponse(shop, data);
  await persist(shop, data, session);
  return session;
}

const isUsable = (session) =>
  Boolean(
    session?.accessToken &&
      (!session.expires ||
        new Date(session.expires).getTime() > Date.now() + 60_000)
  );

// Returns an offline session with a live token for use OUTSIDE the admin (storefront
// proxy, webhooks), refreshing it with the stored refresh_token when it has expired.
// `force` refreshes even if the cached token looks valid (e.g. after a 401).
export async function getOfflineSession(shop, { force = false } = {}) {
  const session = await shopify.config.sessionStorage.loadSession(
    shopify.api.session.getOfflineId(shop)
  );
  if (!session) return null;
  if (!force && isUsable(session)) return session;

  if (!inflightRefresh.has(shop)) {
    inflightRefresh.set(
      shop,
      refreshOfflineToken(shop).finally(() => inflightRefresh.delete(shop))
    );
  }
  return inflightRefresh.get(shop);
}

export async function deleteShopTokens(shop) {
  await (await refreshCollection()).deleteMany({ shop });
  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
  if (sessions.length) {
    await shopify.config.sessionStorage.deleteSessions(sessions.map((s) => s.id));
  }
}
