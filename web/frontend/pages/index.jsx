import React, { useEffect, useState } from "react";
import {
  Banner,
  Button,
  CalloutCard,
  Card,
  Layout,
  Page,
  SkeletonBodyText,
  Stack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useAuthenticatedFetch } from "../hooks";

export default function HomePage() {
  const navigate = useNavigate();
  const fetchAuth = useAuthenticatedFetch();
  const [tier, setTier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activateError, setActivateError] = useState("");

  useEffect(() => {
    loadSubscription();
  }, []);

  async function loadSubscription() {
    try {
      setLoading(true);
      const response = await fetchAuth("/api/hasActiveSubscription");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load subscription.");
      }

      setTier(data?.tier || "free");
    } catch (error) {
      console.error(error);
      setTier("free");
    } finally {
      setLoading(false);
    }
  }

  async function handleActivateCart() {
    setActivateError("");

    try {
      const response = await fetchAuth("/api/getshop");
      const data = await response.json();

      if (!response.ok || !data?.shop) {
        throw new Error("Unable to resolve the store URL.");
      }

      window.open(
        `https://${data.shop}/admin/themes/current/editor?context=apps&activateAppId=b355dba7-d415-49dc-8399-11206b10c9ca/floating-button`,
        "_blank"
      );
    } catch (error) {
      console.error("Activate failed:", error);
      setActivateError(error.message);
    }
  }

  const premiumActive = tier && tier !== "free";

  const statusTone = premiumActive
    ? {
        label: "Premium active",
        color: "#166534",
        background: "rgba(22,101,52,0.08)",
      }
    : {
        label: "Free plan",
        color: "#92400e",
        background: "rgba(146,64,14,0.08)",
      };

  return (
    <Page title="FloatCart" subtitle="Control the floating cart button from one clean dashboard." fullWidth>
      {activateError ? (
        <Banner
          status="critical"
          onDismiss={() => setActivateError("")}
        >
          {activateError}
        </Banner>
      ) : null}

      <div
        style={{
          marginBottom: 24,
          padding: 28,
          borderRadius: 26,
          background:
            "radial-gradient(circle at top left, rgba(201,111,45,0.22), transparent 28%), linear-gradient(135deg, #111827 0%, #1f2937 52%, #c96f2d 100%)",
          color: "#fff",
        }}
      >
        <div style={{ maxWidth: 760 }}>
          <h1
            style={{
              marginTop: 0,
              marginBottom: 12,
              fontSize: 38,
              lineHeight: 1.08,
            }}
          >
            Turn a plain cart shortcut into a storefront-ready conversion touchpoint.
          </h1>
          <p
            style={{
              marginTop: 0,
              marginBottom: 20,
              fontSize: 16,
              lineHeight: 1.7,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            Activate the app embed, manage your plan, and move from a starter
            setup to the full premium storefront experience.
          </p>
          <Stack spacing="tight">
            <Button primary onClick={handleActivateCart}>
              Open theme editor
            </Button>
            <Button onClick={() => navigate("/pricing")}>View pricing</Button>
            <Button onClick={() => navigate("/install")}>Setup guide</Button>
          </Stack>
        </div>
      </div>

      <Layout>
        <Layout.Section>
          <Card sectioned>
            {loading ? (
              <SkeletonBodyText lines={4} />
            ) : (
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: statusTone.background,
                    color: statusTone.color,
                    fontWeight: 700,
                    marginBottom: 16,
                  }}
                >
                  {statusTone.label}
                </div>
                <h2 style={{ marginTop: 0, marginBottom: 10, color: "#111827" }}>
                  Subscription status
                </h2>
                <p style={{ marginTop: 0, color: "#4b5563", lineHeight: 1.7 }}>
                  {premiumActive
                    ? "Your store has access to the full premium storefront controls and production-ready pricing flow."
                    : "You're on the Free plan. Upgrade when you want advanced styling controls, richer storefront options, and a polished live setup."}
                </p>
                <div style={{ marginTop: 18 }}>
                  <Button primary={premiumActive} onClick={() => navigate("/pricing")}>
                    {premiumActive ? "Manage premium" : "Upgrade to Premium"}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <CalloutCard
            title="Go live in minutes"
            primaryAction={{
              content: "Activate app embed",
              onAction: handleActivateCart,
            }}
            illustration="https://cdn.shopify.com/shopifycloud/web/assets/v1/6f0c7f1a5d9c4de6f9f6a9d7d6c948fb.svg"
          >
            <p>
              Jump straight into the theme editor and switch on the floating cart
              embed for the current theme.
            </p>
          </CalloutCard>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned title="What Premium unlocks">
            <Stack vertical spacing="loose">
              <div>Advanced customization controls for storefront styling.</div>
              <div>Premium design presets for a sharper floating cart experience.</div>
              <div>Product total price support and richer cart presentation.</div>
              <div>Production-ready setup for the `floating.solnix.store` domain.</div>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
