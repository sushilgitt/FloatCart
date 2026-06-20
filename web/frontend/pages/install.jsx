import React, { useState } from "react";
import {
  Banner,
  Button,
  Card,
  Layout,
  List,
  Page,
  Stack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useAuthenticatedFetch } from "../hooks";

const steps = [
  {
    title: "Open the current theme editor",
    body: "Launch Shopify's theme editor for the active theme and jump into the app area.",
  },
  {
    title: "Enable the FloatCart app embed",
    body: "Turn on the FloatCart embed so the floating cart button loads on the storefront.",
  },
  {
    title: "Save and preview the storefront",
    body: "Save the theme, visit a product page, and confirm the floating cart button matches your chosen style.",
  },
];

export default function Installation() {
  const navigate = useNavigate();
  const fetchAuth = useAuthenticatedFetch();
  const [error, setError] = useState("");

  async function openThemeEditor() {
    setError("");

    try {
      const response = await fetchAuth("/api/getshop");
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.shop) {
        throw new Error("Unable to resolve the store URL.");
      }

      window.open(
        `https://${data.shop}/admin/themes/current/editor?context=apps&activateAppId=b355dba7-d415-49dc-8399-11206b10c9ca/floating-button`,
        "_blank"
      );
    } catch (requestError) {
      console.error("Unable to open theme editor:", requestError);
      setError(requestError.message || "Failed to open the theme editor.");
    }
  }

  return (
    <Page
      title="Setup guide"
      subtitle="Get FloatCart live in your theme with a short production-ready checklist."
      fullWidth
    >
      {error ? (
        <Banner status="critical" onDismiss={() => setError("")}>
          {error}
        </Banner>
      ) : null}

      <div
        style={{
          marginBottom: 24,
          padding: 28,
          borderRadius: 26,
          background:
            "radial-gradient(circle at top left, rgba(201,111,45,0.18), transparent 28%), linear-gradient(135deg, #fff8f1 0%, #ffffff 58%, #f3f4f6 100%)",
          border: "1px solid rgba(201,111,45,0.18)",
        }}
      >
        <div style={{ maxWidth: 760 }}>
          <div
            style={{
              display: "inline-flex",
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(154,52,18,0.08)",
              color: "#9a3412",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Theme activation
          </div>
          <h1
            style={{
              marginTop: 16,
              marginBottom: 12,
              fontSize: 36,
              lineHeight: 1.1,
              color: "#111827",
            }}
          >
            Turn on the floating cart button in three quick steps.
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 620,
              color: "#4b5563",
              fontSize: 16,
              lineHeight: 1.7,
            }}
          >
            The app setup lives inside your theme. Once the app embed is enabled,
            the storefront can start using the FloatCart experience immediately.
          </p>
          <div style={{ marginTop: 20 }}>
            <Stack spacing="tight">
              <Button primary onClick={openThemeEditor}>
                Open theme editor
              </Button>
              <Button onClick={() => navigate("/pricing")}>
                Review Premium plan
              </Button>
              <Button onClick={() => navigate("/")}>Back to dashboard</Button>
            </Stack>
          </div>
        </div>
      </div>

      <Layout>
        <Layout.Section>
          <Card sectioned title="Checklist">
            <List type="number">
              {steps.map((step) => (
                <List.Item key={step.title}>
                  <strong>{step.title}</strong>
                  <div style={{ marginTop: 6, color: "#4b5563" }}>{step.body}</div>
                </List.Item>
              ))}
            </List>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned title="What to verify on the storefront">
            <Stack vertical spacing="loose">
              <div>The floating cart button appears on product pages.</div>
              <div>The position and spacing work on both mobile and desktop.</div>
              <div>Premium styling options are visible if your store is upgraded.</div>
            </Stack>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned title="Need help while setting up?">
            <Stack vertical spacing="tight">
              <div>Use the pricing page to switch between Free and Premium anytime.</div>
              <div>Return to the dashboard to monitor the store's active plan.</div>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
