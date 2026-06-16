with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

# 1. Add RequestedTokenType import
old_import = 'import shopify from "./shopify.js";'
new_import = 'import shopify from "./shopify.js";\nimport { RequestedTokenType } from "@shopify/shopify-api";'

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    print('Import added')
else:
    print('Import NOT FOUND')

# 2. Add billing/start endpoint BEFORE validateAuthenticatedSession
billing_endpoint = '''
/* ---- Billing: Token Exchange endpoint (bypasses validateAuthenticatedSession) ---- */
app.get("/api/billing/start", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const bearerMatch = authHeader && authHeader.match(/Bearer (.*)/);
        if (!bearerMatch) return res.status(401).json({ error: "Missing authorization" });

        const sessionToken = bearerMatch[1];
        const payload = await shopify.api.session.decodeSessionToken(sessionToken);
        const shop = payload.dest.replace("https://", "");

        let session;
        try {
            const result = await shopify.api.auth.tokenExchange({
                sessionToken,
                shop,
                requestedTokenType: RequestedTokenType.OfflineAccessToken,
            });
            session = result.session;
            await shopify.config.sessionStorage.storeSession(session);
            console.log("Token exchange success for", shop, "prefix:", session.accessToken.substring(0, 12));
        } catch (txErr) {
            console.error("Token exchange failed, falling back to stored session:", txErr.message);
            session = await getOfflineSessionByShop(shop);
            if (!session) return res.status(401).json({ error: "No session found" });
        }

        const returnUrl = process.env.HOST + "/api/billing/callback?shop=" + encodeURIComponent(shop);
        const billingResult = await shopify.api.billing.request({
            session,
            plan: PREMIUM_PLAN,
            isTest: IS_TEST,
            returnUrl,
        });

        const confirmationUrl = typeof billingResult === "string" ? billingResult : billingResult?.confirmationUrl;
        console.log("Billing URL for", shop, ":", confirmationUrl);
        return res.status(200).json({ confirmationUrl, isActiveSubscription: false });
    } catch (err) {
        console.error("Billing start error:", err.message || err);
        return res.status(500).json({ error: err.message || "Billing failed" });
    }
});

'''

old_middleware = '/* ----------------------- Protected Routes ----------------------- */\napp.use("/api/*splat", shopify.validateAuthenticatedSession());'
new_middleware = billing_endpoint + '/* ----------------------- Protected Routes ----------------------- */\napp.use("/api/*splat", shopify.validateAuthenticatedSession());'

if old_middleware in content:
    content = content.replace(old_middleware, new_middleware, 1)
    print('billing/start endpoint added')
else:
    print('Middleware anchor NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')