const { MongoClient } = require('/home/theharsh/apps/anchor-cart/web/node_modules/mongodb');
async function main() {
  const client = new MongoClient('mongodb+srv://sahilvsabai_db_user:fB73q96YO1kOKlF7@anchor.moadyjv.mongodb.net/anchor-cart-v5');
  await client.connect();
  const db = client.db('anchor-cart-v5');
  const sessions = await db.collection('shopify_sessions').find({ shop: 'test-1-oylt9ns7.myshopify.com' }).toArray();
  sessions.forEach(s => console.log(JSON.stringify({ id: s.id, prefix: (s.accessToken||'').substring(0,15), scope: s.scope, expires: s.expires })));
  await client.close();
}
main().catch(console.error);