with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'r') as f:
    content = f.read()
content = content.replace('fetchAuth("/api/cancelSubscription")', 'fetchAuth("/api/billing/cancel")')
with open('/home/theharsh/apps/anchor-cart/web/frontend/pages/Pricing.jsx', 'w') as f:
    f.write(content)
print('Done')