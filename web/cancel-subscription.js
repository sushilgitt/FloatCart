import shopify from "./shopify.js";

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

/**
 * Cancels the given app subscription. Callers pass the Premium subscription id from
 * billing.check so we never cancel an unrelated (e.g. non-Premium) subscription.
 * @returns {Promise<string>} the cancelled subscription status.
 */
export default async function cancelSubscription(session, subscriptionId) {
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
