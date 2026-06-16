with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

old = "            await shopify.config.sessionStorage.storeSession(callbackResponse.session);\n\n            // Webhook auto-registration is intentionally disabled for now."

new = """            let sessionToStore = callbackResponse.session;

            // Migrate shpat_ (non-expiring) tokens immediately after OAuth
            if (sessionToStore.accessToken && sessionToStore.accessToken.startsWith("shpat_")) {
                try {
                    console.log("OAuth gave shpat_ token, migrating to expiring token for", sessionToStore.shop);
                    const migrated = await shopify.api.auth.migrateToExpiringToken({
                        shop: sessionToStore.shop,
                        nonExpiringOfflineAccessToken: sessionToStore.accessToken,
                    });
                    if (migrated && migrated.session) {
                        sessionToStore = migrated.session;
                        console.log("Token migrated, new prefix:", sessionToStore.accessToken.substring(0, 12));
                    }
                } catch (migrateErr) {
                    console.error("Token migration failed:", migrateErr.message || migrateErr);
                }
            }

            await shopify.config.sessionStorage.storeSession(sessionToStore);

            // Webhook auto-registration is intentionally disabled for now."""

if old in content:
    content = content.replace(old, new, 1)
    print('OAuth migration patch applied')
else:
    print('PATTERN NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')