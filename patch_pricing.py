import re

with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'r') as f:
    content = f.read()

# Fix 1: move 401/403 check before res.json() in redirectToPricingPlans
old1 = (
    '      const res = await fetchAuth("/api/createSubscription");\n'
    '      const data = await res.json();\n'
    '\n'
    '      // Let checkHeadersForReauthorization handle re-auth silently\n'
    '      if (res.status === 401 || res.status === 403) { setIsSubmitting(false); return; }\n'
    '      if (!res.ok)'
)
new1 = (
    '      const res = await fetchAuth("/api/createSubscription");\n'
    '\n'
    '      // Let checkHeadersForReauthorization handle re-auth silently\n'
    '      if (res.status === 401 || res.status === 403) { setIsSubmitting(false); return; }\n'
    '\n'
    '      const data = await res.json();\n'
    '      if (!res.ok)'
)

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('Fix 1 applied')
else:
    print('Fix 1 NOT FOUND')

# Fix 2: add 401/403 guard in runConfirm before res.json()
old2 = (
    '          const res = await fetchAuth("/api/createSubscription");\n'
    '          const data = await res.json();\n'
    '\n'
    '          if (data.confirmationUrl)'
)
new2 = (
    '          const res = await fetchAuth("/api/createSubscription");\n'
    '\n'
    '          if (res.status === 401 || res.status === 403) { setIsSubmitting(false); return; }\n'
    '\n'
    '          const data = await res.json();\n'
    '          if (data.confirmationUrl)'
)

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('Fix 2 applied')
else:
    print('Fix 2 NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'w') as f:
    f.write(content)
print('Saved')