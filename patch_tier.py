with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

old = """    try {
        const grantedScope = String(session?.scope || "");
        const hasBillingScope =
            grantedScope.includes("read_own_subscription_contracts") ||
            grantedScope.includes("write_own_subscription_contracts");

        if (!hasBillingScope) {
            console.warn(`Skipping billing.check due to missing subscription scopes for ${session?.shop}`);
            return "free";
        }

        const hasPremium = await shopify.api.billing.check({"""

new = """    try {
        const hasPremium = await shopify.api.billing.check({"""

if old in content:
    content = content.replace(old, new, 1)
    print('getPlanTier scope guard removed')
else:
    print('PATTERN NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')