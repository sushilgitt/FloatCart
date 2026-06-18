import shopify from "./shopify.js";

const RECURRING_PURCHASES_QUERY = `
  query appSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        test
        status
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION = `
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        name
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function getActiveSubscriptionId(session) {
  const client = new shopify.api.clients.Graphql({ session });
  // @shopify/shopify-api v11: client.request(query) -> { data, errors, extensions }
  const response = await client.request(RECURRING_PURCHASES_QUERY);
  const subscriptions =
    response?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return subscriptions.length ? subscriptions[0].id : null;
}

/**
 * Cancels the store's active app subscription (if any).
 * @returns {Promise<string>} the cancelled subscription status, or
 *   "No subscription found" when there is nothing to cancel.
 */
export default async function cancelSubscription(session) {
  const subscriptionId = await getActiveSubscriptionId(session);

  if (!subscriptionId) {
    return "No subscription found";
  }

  const client = new shopify.api.clients.Graphql({ session });
  const response = await client.request(CANCEL_SUBSCRIPTION, {
    variables: { id: subscriptionId },
  });

  const userErrors = response?.data?.appSubscriptionCancel?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `Failed to cancel subscription: ${userErrors
        .map((error) => error.message)
        .join(", ")}`
    );
  }

  console.log("Subscription cancelled successfully:", session.shop);
  return (
    response?.data?.appSubscriptionCancel?.appSubscription?.status ?? "CANCELLED"
  );
}
