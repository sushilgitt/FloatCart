with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

old = "            const result = await shopify.api.auth.tokenExchange({\n                sessionToken,\n                shop,\n                requestedTokenType: RequestedTokenType.OfflineAccessToken,\n            });"
new = "            const result = await shopify.api.auth.tokenExchange({\n                sessionToken,\n                shop,\n                requestedTokenType: RequestedTokenType.OnlineAccessToken,\n            });"

if old in content:
    content = content.replace(old, new, 1)
    print('Switched to OnlineAccessToken')
else:
    print('NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')