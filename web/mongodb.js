import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || "solnix_floatcart";
const collectionName =
  process.env.MONGODB_COLLECTION || "shopify_sessions";

let client;

export const connectToMongoDB = async () => {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    console.log("Connected to MongoDB for session storage");
  }

  return client.db(dbName).collection(collectionName);
};
