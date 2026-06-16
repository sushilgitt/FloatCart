const { MongoClient } = require('/home/theharsh/apps/anchor-cart/web/node_modules/mongodb');
const client = new MongoClient('mongodb+srv://sahilvsabai_db_user:fB73q96YO1kOKlF7@anchor.moadyjv.mongodb.net/anchor-cart-v5');
client.connect().then(async () => {
  const db = client.db('anchor-cart-v5');
  const sessions = await db.collection('shopify_sessions').find({ shop: 'test-1-oylt9ns7.myshopify.com' }).toArray();
  sessions.forEach(s => {
    const tok = s.accessToken || '';
    console.log(JSON.stringify({ shop: s.shop, prefix: tok.substring(0, 12), expires: s.expires, scope: s.scope }));
  });
  await client.close();
}).catch(e => console.error(e.message));