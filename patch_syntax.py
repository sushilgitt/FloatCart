import re

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

# Fix: billing.check({...}; -> billing.check({...});
# The regex ate the closing ) - add it back
fixed = re.sub(
    r'(= await shopify\.api\.billing\.check\(\{[^;]+?\})\s*;(\s*\n\s*const \w+ = typeof)',
    r'\1);\2',
    content,
    flags=re.DOTALL
)

# Also clean up double-wrap in getPlanTier
fixed = re.sub(
    r'const _checkResult1Raw = (await shopify\.api\.billing\.check\([^;]+;\n)\s*const _checkResult1 = typeof _checkResult1Raw[^\n]+\n\s*const hasPremium = typeof _checkResult1[^\n]+',
    r'const _billingRaw = \1        const hasPremium = typeof _billingRaw === "object" ? _billingRaw.hasActivePayment : _billingRaw;',
    fixed,
    flags=re.DOTALL
)

if fixed != content:
    print('Fixed syntax errors')
    content = fixed
else:
    print('No changes made by regex')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')