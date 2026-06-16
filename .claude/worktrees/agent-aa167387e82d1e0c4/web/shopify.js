import { BillingInterval, LATEST_API_VERSION } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import {MongoDBSessionStorage} from '@shopify/shopify-app-session-storage-mongodb';
import { restResources } from "@shopify/shopify-api/rest/admin/2023-04";
import dotenv from "dotenv";


dotenv.config();


// The transactions with Shopify will always be marked as test transactions, unless NODE_ENV is production.
// See the ensureBilling helper to learn more about billing in this template.
const billingConfig = {
  "MeroxIO Basic": {
    // This is an example configuration that would do a one-time charge for $5 (only USD is currently supported)
    amount: 10.00,
    currencyCode: "USD",
    trialDays: 0,
    interval: BillingInterval.Every30Days,
  },
 
  "MeroxIO Premium": {
    // Added second plan with the same structure, at $99.99 (USD)
    amount: 100.00,
    currencyCode: "USD",
    trialDays: 0,
    interval: BillingInterval.Every30Days,
  },
};

const shopify = shopifyApp({
  api: {
    apiVersion: LATEST_API_VERSION,
    restResources,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    hostName: process.env.HOST.replace(/https?:\/\//, ""),
    scopes: process.env.SCOPES.split(","),
    billing: billingConfig, // or replace with billingConfig above to enable example billing
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  // This should be replaced with your preferred storage strategy
  sessionStorage: new MongoDBSessionStorage(
    'mongodb+srv://meroxio:%40%23MeroxIO%23%40@cluster0.xcu2ogt.mongodb.net/?retryWrites=true&w=majority',
    'floating-cart-button',
  ),
});

export default shopify;
