const { MongoClient } = require('/home/theharsh/apps/anchor-cart/web/node_modules/mongodb');
const https = require('https');

async function main() {
  const client = new MongoClient('mongodb+srv://sahilvsabai_db_user:fB73q96YO1kOKlF7@anchor.moadyjv.mongodb.net/anchor-cart-v5');
  await client.connect();
  const db = client.db('anchor-cart-v5');
  const sessions = await db.collection('shopify_sessions').find({ shop: 'test-1-oylt9ns7.myshopify.com' }).toArray();
  await client.close();
  const token = sessions[0].accessToken;
  console.log('Token prefix:', token.substring(0, 15));

  const query = `{ currentAppInstallation { activeSubscriptions { id name status test createdAt } } }`;
  const body = JSON.stringify({ query });
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