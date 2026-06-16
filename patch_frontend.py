with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'r') as f:
    content = f.read()

content = content.replace('fetchAuth("/api/createSubscription")', 'fetchAuth("/api/billing/start")')
print('Replacements:', content.count('/api/billing/start'))

with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'w') as f:
    f.write(content)
print('Saved')