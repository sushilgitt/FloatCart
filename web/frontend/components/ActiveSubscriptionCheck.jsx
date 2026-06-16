import { Banner } from "@shopify/polaris";
import { useState } from "react";
import { useAppQuery } from "../hooks";

export function ActiveSubscription() {
  const [dismissed, setDismissed] = useState(false);
  const { data, isLoading } = useAppQuery({
    url: "/api/hasActiveSubscription",
  });

  if (dismissed || isLoading) {
    return null;
  }

  if (data?.hasActiveSubscription) {
    return (
      <Banner
        title="Current plan: Premium"
        status="success"
        onDismiss={() => setDismissed(true)}
      >
        <p>
          Premium is active for this store, so all FloatCart storefront features
          are available.
        </p>
      </Banner>
    );
  }

  return (
    <Banner
      title="Current plan: Free"
      status="warning"
      onDismiss={() => setDismissed(true)}
    >
      <p>
        The store is currently on the Free plan. Upgrade from the pricing page
        to unlock the full Premium storefront experience.
      </p>
    </Banner>
  );
}
