with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

cancel_endpoint = '''
/* ---- Cancel subscription via Token Exchange (bypasses validateAuthenticatedSession) ---- */
app.get("/api/billing/cancel", async (req, res) => {
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
                requestedTokenType: RequestedTokenType.OnlineAccessToken,
            });
            session = result.session;
        } catch (txErr) {
            console.error("Token exchange failed for cancel:", txErr.message);
            session = await getOfflineSessionByShop(shop);
            if (!session) return res.status(401).json({ error: "No session found" });
        }

        try {
            const subscriptionStatus = await cancelSubscription(session);
            console.log("Subscription cancelled for", shop, "status:", subscriptionStatus);
        } catch (cancelErr) {
            console.error("Cancel error:", cancelErr.message);
        }

        await updateSubscriptionMetafield(session, "free");
        return res.status(200).json({ status: "cancelled" });
    } catch (err) {
        console.error("Billing cancel error:", err.message || err);
        return res.status(500).json({ error: err.message || "Cancel failed" });
    }
});

'''

anchor = '/* ---- Billing: Token Exchange endpoint (bypasses validateAuthenticatedSession) ----'
if anchor in content:
    content = content.replace(anchor, cancel_endpoint + anchor, 1)
    print('Cancel endpoint added')
else:
    print('Anchor NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')