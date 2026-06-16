with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

old = """        // Check if already on premium
        const hasPaymentRaw = await shopify.api.billing.check({
            session,
            plans: [PREMIUM_PLAN],
            isTest: IS_TEST,
        });
        const hasPayment = typeof hasPaymentRaw === 'object' ? hasPaymentRaw.hasActivePayment : hasPaymentRaw;

        if (hasPayment) {
            console.log(`✅ ${session.shop} is already subscribed to: ${PREMIUM_PLAN}`);

            // Make sure metafield is in sync
            await updateSubscriptionMetafield(session, "premium");

            return res.status(200).send({
                isActiveSubscription: true,
                plan: PREMIUM_PLAN,
            });
        }

        console.log(`➡️ ${session.shop} opening billing for upgrade to: ${PREMIUM_PLAN}`);"""

new = """        console.log(`➡️ ${session.shop} opening billing for upgrade to: ${PREMIUM_PLAN}`);"""

if old in content:
    content = content.replace(old, new, 1)
    print('billing.check removed from createSubscription')
else:
    print('PATTERN NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')