with open('/home/theharsh/apps/anchor-cart/web/index.js', 'r') as f:
    content = f.read()

old = '        const host = Buffer.from(shop + "/admin").toString("base64url");\n        return res.redirect(process.env.HOST + "?shop=" + encodeURIComponent(shop) + "&host=" + host);'
new = '        const shopPrefix = shop.replace(".myshopify.com", "");\n        const host = Buffer.from("admin.shopify.com/store/" + shopPrefix).toString("base64url");\n        return res.redirect(process.env.HOST + "?shop=" + encodeURIComponent(shop) + "&host=" + host);'

if old in content:
    content = content.replace(old, new, 1)
    print('Host param fixed')
else:
    print('NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/index.js', 'w') as f:
    f.write(content)
print('Saved')