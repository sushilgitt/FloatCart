with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

def fix_billing_check(content, old_var, new_var=None):
    """Replace raw billing.check result usage with .hasActivePayment aware version"""
    return content

# We will do a targeted replacement of each billing.check block
replacements = [
    # getPlanTier - line ~221
    (
        "        const hasPremium = await shopify.api.billing.check({\n            session,\n            plans: [PREMIUM_PLAN],\n            isTest: IS_TEST,\n        });\n\n        return hasPremium ? \"premium\" : \"free\";",
        "        const _checkResult1 = await shopify.api.billing.check({\n            session,\n            plans: [PREMIUM_PLAN],\n            isTest: IS_TEST,\n        });\n        const hasPremium = typeof _checkResult1 === 'object' ? _checkResult1.hasActivePayment : _checkResult1;\n\n        return hasPremium ? \"premium\" : \"free\";"
    ),
]

count = 0
for old, new in replacements:
    if old in content:
        content = content.replace(old, new, 1)
        count += 1
        print(f'Replaced: {old[:60]}...')
    else:
        print(f'NOT FOUND: {old[:60]}...')

# Now do a global fix: after every `billing.check(` call, wrap the result
# Strategy: find all `const X = await shopify.api.billing.check(` and add a normalize line
import re

# Pattern: const <var> = await shopify.api.billing.check({...});
# Replace with: const <var>Raw = await ...; const <var> = typeof <var>Raw === 'object' ? <var>Raw.hasActivePayment : <var>Raw;
def normalize_check(m):
    varname = m.group(1)
    call = m.group(2)
    return f"const {varname}Raw = await shopify.api.billing.check({call};\n        const {varname} = typeof {varname}Raw === 'object' ? {varname}Raw.hasActivePayment : {varname}Raw;"

# Match: const VARNAME = await shopify.api.billing.check(BODY);
# where BODY spans multiple lines with balanced braces
pattern = r'const (\w+) = await shopify\.api\.billing\.check\((\{[^;]+?\}[^;]*)\);'
new_content = re.sub(pattern, normalize_check, content, flags=re.DOTALL)

if new_content != content:
    print('Regex replacements applied')
    content = new_content
else:
    print('No regex matches found')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')