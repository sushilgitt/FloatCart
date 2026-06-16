import { MongoClient } from "mongodb";

const uri = "mongodb+srv://meroxio:%40%23MeroxIO%23%40@cluster0.xcu2ogt.mongodb.net/?retryWrites=true&w=majority"; // Update with your connection string
const dbName = "floating-cart-button"; // Name of your database
const collectionName = "shopify_sessions"; // Collection to store sessions

let client;

export const connectToMongoDB = async () => {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    console.log("Connected to MongoDB for session storage");
  }
  return client.db(dbName).collection(collectionName);
};
