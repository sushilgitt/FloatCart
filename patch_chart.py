with open('/home/theharsh/apps/anchor-cart/web/frontend/components/AnalyticsChart.jsx', 'r') as f:
    content = f.read()

old = """    const urlParams = new URLSearchParams(window.location.search);
    const shopParam = urlParams.get("shop");

    if (shopParam) {
      setShop(shopParam);
    } else {
      setError("Shop parameter is missing from the URL.");
    }"""

new = """    const urlParams = new URLSearchParams(window.location.search);
    const shopParam = urlParams.get("shop")
      || window.__SHOPIFY_SHOP
      || (() => { try { return localStorage.getItem("shopify_shop"); } catch(e) { return null; } })();

    if (shopParam) {
      if (window.__SHOPIFY_SHOP !== shopParam) { try { localStorage.setItem("shopify_shop", shopParam); } catch(e) {} }
      window.__SHOPIFY_SHOP = shopParam;
      setShop(shopParam);
    } else {
      setError("Shop parameter is missing from the URL.");
    }"""

if old in content:
    content = content.replace(old, new, 1)
    print('AnalyticsChart shop fallback added')
else:
    print('NOT FOUND')

with open('/home/theharsh/apps/anchor-cart/web/frontend/components/AnalyticsChart.jsx', 'w') as f:
    f.write(content)
print('Saved')