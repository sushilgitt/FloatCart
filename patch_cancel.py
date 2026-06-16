with open('/home/theharsh/apps/anchor-cart/web/cancel-subscription.js', 'r') as f:
    content = f.read()

# Fix getActiveSubsId
old1 = """      const currentInstallations = await client.query({
        data: RECURRING_PURCHASES_QUERY,
      });
      const subscriptions =
        currentInstallations.body.data.currentAppInstallation.activeSubscriptions;"""
new1 = """      const currentInstallations = await client.request(RECURRING_PURCHASES_QUERY);
      const subscriptions =
        currentInstallations.data.currentAppInstallation.activeSubscriptions;"""

# Fix appSubscriptionCancel
old2 = """    const mutationResponse = await client.query({
      data: {
        query: CANCEL_SUBSCRIPTION,
        variables: {
          id: subscriptionId
        },
      },
    });

    if (mutationResponse.body.errors && mutationResponse.body.errors.length) {
      throw new Error(`Error while subscription cancel: ${JSON.stringify(mutationResponse.body.errors)}`);
    } else {
      const userErrors = mutationResponse.body?.data?.appSubscriptionCancel?.userErrors || [];
      if (userErrors.length) {
        throw new Error(`Subscription cancel userErrors: ${JSON.stringify(userErrors)}`);
      }
      console.log("Subscription canceled successfully: ", session.shop);
      //console.log("Status: ", mutationResponse.body.data.appSubscriptionCancel.appSubscription.status);
    }

    return mutationResponse.body?.data?.appSubscriptionCancel?.appSubscription?.status || "UNKNOWN";"""
new2 = """    const mutationResponse = await client.request(CANCEL_SUBSCRIPTION, { variables: { id: subscriptionId } });

    const userErrors = mutationResponse.data?.appSubscriptionCancel?.userErrors || [];
    if (userErrors.length) {
      throw new Error(`Subscription cancel userErrors: ${JSON.stringify(userErrors)}`);
    }
    console.log("Subscription canceled successfully: ", session.shop);

    return mutationResponse.data?.appSubscriptionCancel?.appSubscription?.status || "UNKNOWN";"""

for old, new in [(old1, new1), (old2, new2)]:
    if old in content:
        content = content.replace(old, new, 1)
        print('Patched')
    else:
        print('NOT FOUND:', old[:60])

with open('/home/theharsh/apps/anchor-cart/web/cancel-subscription.js', 'w') as f:
    f.write(content)
print('Saved')