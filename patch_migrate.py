with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

migration_middleware = '''
/* ---- Migrate shpat_ (non-expiring) tokens to expiring tokens automatically ---- */
app.use("/api/*splat", async (req, res, next) => {
    try {
        const shop = req.query.shop || (req.headers["x-shopify-shop-domain"]);
        if (shop) {
            const session = await getOfflineSessionByShop(String(shop));
            if (session && session.accessToken && session.accessToken.startsWith("shpat_")) {
                try {
                    console.log("Migrating shpat_ token for", session.shop);
                    const result = await shopify.api.auth.migrateToExpiringToken({
                        shop: session.shop,
                        nonExpiringOfflineAccessToken: session.accessToken,
                    });
                    if (result && result.session) {
                        await shopify.config.sessionStorage.storeSession(result.session);
                        console.log("Token migrated for", session.shop, "new prefix:", result.session.accessToken.substring(0, 12));
                    }
                } catch (migrateErr) {
                    console.error("Token migration failed:", migrateErr.message || migrateErr);
                }
            }
        }
    } catch (e) {
        // never block the request
    }
    next();
});

'''

old = '/* ----------------------- Protected Routes ----------------------- */\napp.use("/api/*splat", shopify.validateAuthenticatedSession());'
new = migration_middleware + '/* ----------------------- Protected Routes ----------------------- */\napp.use("/api/*splat", shopify.validateAuthenticatedSession());'

if old in content:
    content = content.replace(old, new, 1)
    print('Migration middleware inserted')
else:
    print('PATTERN NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')