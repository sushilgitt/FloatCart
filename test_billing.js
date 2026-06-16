const { MongoClient } = require('/home/theharsh/apps/anchor-cart/web/node_modules/mongodb');
const https = require('https');

async function main() {
  const client = new MongoClient('mongodb+srv://sahilvsabai_db_user:fB73q96YO1kOKlF7@anchor.moadyjv.mongodb.net/anchor-cart-v5');
  await client.connect();
  const sessions = await client.db('anchor-cart-v5').collection('shopify_sessions').find({ shop: 'test-1-oylt9ns7.myshopify.com' }).toArray();
  await client.close();
  const token = sessions[0].accessToken;
  console.log('Token:', token.substring(0, 15));

  const mutation = `mutation { appSubscriptionCreate(name: "Premium Plan", returnUrl: "https://anchor.onkra.online/api/billing/callback?shop=test-1-oylt9ns7.myshopify.com", test: true, lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 99.99, currencyCode: USD }, interval: EVERY_30_DAYS } } }]) { userErrors { field message } appSubscription { id } confirmationUrl } }`;
  const body = JSON.stringify({ query: mutation });
  const options = {
    hostname: 'test-1-oylt9ns7.myshopify.com',
    path: '/admin/api/2026-04/graphql.json',
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const result = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  console.log('Status:', result.status);
  console.log('Response:', result.body);
}
main().catch(console.error);