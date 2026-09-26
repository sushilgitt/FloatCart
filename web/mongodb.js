import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || "solnix_floatcart";
const collectionName =
  process.env.MONGODB_COLLECTION || "shopify_sessions";

let clientPromise;

export const getDb = async () => {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!clientPromise) {
    // Share one connection across concurrent callers; reset on failure so the next
    // call can retry instead of reusing a rejected promise forever.
    clientPromise = new MongoClient(uri).connect().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
    clientPromise.then(() => console.log("Connected to MongoDB"));
  }

  return (await clientPromise).db(dbName);
};

export const connectToMongoDB = async () =>
  (await getDb()).collection(collectionName);
