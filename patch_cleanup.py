with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

# Clean up the double-wrap in getPlanTier
old = (
    "        const _checkResult1Raw = await shopify.api.billing.check({\n"
    "            session,\n"
    "            plans: [PREMIUM_PLAN],\n"
    "            isTest: IS_TEST,\n"
    "        });\n"
    "        const _checkResult1 = typeof _checkResult1Raw === 'object' ? _checkResult1Raw.hasActivePayment : _checkResult1Raw;\n"
    "        const hasPremium = typeof _checkResult1 === 'object' ? _checkResult1.hasActivePayment : _checkResult1;\n"
)
new = (
    "        const _billingCheckRaw = await shopify.api.billing.check({\n"
    "            session,\n"
    "            plans: [PREMIUM_PLAN],\n"
    "            isTest: IS_TEST,\n"
    "        });\n"
    "        const hasPremium = typeof _billingCheckRaw === 'object' ? _billingCheckRaw.hasActivePayment : _billingCheckRaw;\n"
)

if old in content:
    content = content.replace(old, new, 1)
    print('Cleaned up double-wrap')
else:
    print('Double-wrap pattern not found')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')