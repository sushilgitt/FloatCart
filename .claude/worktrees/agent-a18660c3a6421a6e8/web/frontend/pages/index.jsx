import React, { useState, useEffect } from "react";
import {
  Card,
  Page,
  Layout,
  TextContainer,
  Button,
  Modal,
  Frame,
  TopBar,
  CalloutCard,
  DisplayText,
  Toast,
  SkeletonBodyText,
  Banner,
} from "@shopify/polaris";
import { useAppQuery, useAuthenticatedFetch } from "../hooks";
import { useNavigate } from "react-router-dom";
import { Redirect } from "@shopify/app-bridge/actions";
import { useAppBridge } from "@shopify/app-bridge-react";
import { shopifyBackground } from "../assets";

export default function HomePage() {
  const emptyToastProps = { content: null };
  const [toastProps, setToastProps] = useState(emptyToastProps);
  const [selectedPlan, setSelectedPlan] = useState("free"); // default Free
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [confirmPlan, setConfirmPlan] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [activateError, setActivateError] = useState(null);

  const app = useAppBridge();
  const fetch = useAuthenticatedFetch();
  const redirect = Redirect.create(app);

  // --- Prices map ---
  const planPrices = {
    basic: "10.00",
    premium: "100.00",
  };

  // Fetch current plan
  const { data: subscriptionData, isLoading } = useAppQuery({
    url: "/api/hasActiveSubscription",
  });

  useEffect(() => {
    if (subscriptionData?.tier) {
      // Map backend tiers → frontend tiers
      let frontendTier = "free";
      if (subscriptionData.tier === "premium") frontendTier = "basic";
      if (subscriptionData.tier === "unlimited") frontendTier = "premium";
      setSelectedPlan(frontendTier);
    }
  }, [subscriptionData]);

  // --- Handle plan click ---
  const requestPlanChange = (plan) => {
    setConfirmPlan(plan);
    setShowConfirm(true);
  };

  const confirmSubscription = async () => {
    if (!confirmPlan) return;

    // Case 1: Already on this plan
    if (selectedPlan === confirmPlan) {
      setToastProps({ content: `You are already on the ${confirmPlan} plan ✅` });
      setShowConfirm(false);
      return;
    }

    // Case 2: Switching to free (cancel subscription)
    if (confirmPlan === "free") {
      setLoadingPlan(confirmPlan);
      try {
        const res = await fetch("/api/cancelSubscription");
        const data = await res.json();

        if (data.status && data.status !== "No subscription found") {
          setSelectedPlan("free");
          setToastProps({ content: "Subscription cancelled, switched to Free plan ✅" });
        } else {
          setToastProps({ content: "Failed to cancel subscription", error: true });
        }
      } catch (err) {
        setToastProps({ content: "Cancel failed ❌", error: true });
      } finally {
        setLoadingPlan(null);
        setShowConfirm(false);
      }
      return;
    }

    // Case 3: Switching to paid plan
    setLoadingPlan(confirmPlan);

    // Map frontend → backend values
    let backendPlan = confirmPlan;
    if (confirmPlan === "basic") backendPlan = "premium"; // frontend basic = backend premium
    if (confirmPlan === "premium") backendPlan = "unlimited"; // frontend premium = backend unlimited

    try {
      const res = await fetch(`/api/createSubscription?plan=${backendPlan}`);
      const data = await res.json();
      if (data.confirmationUrl) {
        setToastProps({ content: "Redirecting to payment page..." });
        redirect.dispatch(Redirect.Action.REMOTE, data.confirmationUrl);
      } else if (data.error) {
        setToastProps({ content: data.error, error: true });
      }
    } catch (err) {
      setToastProps({ content: "Something went wrong ❌", error: true });
    } finally {
      setLoadingPlan(null);
      setShowConfirm(false);
    }
  };

  // --- Activate Floating Cart Button ---
  // --- Activate Floating Cart Button (App Embed) ---
const handleActivateCart = async () => {
  setActivateError(null);
  try {
    const response = await fetch("/api/getshop");
    if (!response.ok) throw new Error("Failed to get shop URL");
    const data = await response.json();
    if (!data.shop) throw new Error("Shop URL not available");

    // ✅ Redirect directly to Shopify Theme Editor → App embeds → Floating Cart Button
    window.open(
      `https://${data.shop}/admin/themes/current/editor?context=apps&activateAppId=b355dba7-d415-49dc-8399-11206b10c9ca/floating-cart-embed`,
      "_blank"
    );
  } catch (error) {
    console.error("❌ Activate failed:", error);
    setActivateError(error.message);
  }
};


  const toastMarkup =
    toastProps.content && (
      <Toast {...toastProps} onDismiss={() => setToastProps(emptyToastProps)} />
    );

  // --- Header setup ---
  const navigate = useNavigate();
  const logo = {
    width: 450,
    height: 90,
    topBarSource: `https://cdn.shopify.com/s/files/1/0908/8562/0025/files/MeroxIO_Comparison_Slider_2.png?v=1738650835`,
    url: "/",
    accessibilityLabel: "MeroxIO Logo",
  };

  const topBarMarkup = <TopBar />;

  // ✅ Plans now only 3
  const plans = ["free", "basic", "premium"];

  return (
    <Frame topBar={topBarMarkup} logo={logo}>
      <Page>
        {toastMarkup}
        <Layout>
          {/* Plan Selector */}
          <Layout.Section>
            <Card title="Floating Cart Button Plans" sectioned>
              {isLoading ? (
                <div style={{ display: "flex", gap: "12px" }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <SkeletonBodyText lines={1} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", gap: "12px" }}>
                  {plans.map((plan) => (
                    <Button
                      key={plan}
                      primary={selectedPlan === plan}
                      pressed={selectedPlan === plan}
                      loading={loadingPlan === plan}
                      onClick={() => requestPlanChange(plan)}
                    >
                      {plan === "free"
                        ? "Free"
                        : plan === "basic"
                        ? "Basic"
                        : "Premium"}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          </Layout.Section>

          {/* Confirmation Modal */}
          <Modal
            open={showConfirm}
            onClose={() => setShowConfirm(false)}
            title="Confirm Subscription"
            primaryAction={{
              content:
                selectedPlan === confirmPlan
                  ? "Okay, Got it"
                  : confirmPlan === "free"
                  ? "Yes, Cancel Subscription"
                  : `Subscribe for $${planPrices[confirmPlan] || "0.00"}`,
              onAction: confirmSubscription,
              loading: loadingPlan === confirmPlan,
            }}
            secondaryActions={
              selectedPlan !== confirmPlan
                ? [{ content: "No, Go Back", onAction: () => setShowConfirm(false) }]
                : []
            }
          >
            <Modal.Section>
              {selectedPlan === confirmPlan ? (
                <p>
                  You are already on the <b>{confirmPlan?.toUpperCase()}</b> plan ✅
                </p>
              ) : confirmPlan === "free" ? (
                <p>
                  Are you sure you want to cancel your current{" "}
                  <b>{selectedPlan?.toUpperCase()}</b> subscription and switch to{" "}
                  <b>FREE</b>?
                </p>
              ) : (
                <p>
                  Are you sure you want to subscribe to the{" "}
                  <b>{confirmPlan?.toUpperCase()}</b> plan for{" "}
                  <b>${planPrices[confirmPlan]}</b> per month?
                </p>
              )}
            </Modal.Section>
          </Modal>

          {/* Status Banner (if error) */}
          {activateError && (
            <Layout.Section>
              <Banner status="critical" onDismiss={() => setActivateError(null)}>
                {activateError}
              </Banner>
            </Layout.Section>
          )}

          {/* Callout Section */}
          <Layout.Section>
            <div className="custom-callout-container">
              <CalloutCard
                title="Activate Floating Cart Button"
                illustration="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                primaryAction={{
                  content: "Activate Now ➡️",
                  onAction: handleActivateCart,
                }}
              >
                <p>
                  Ready to enhance your store's cart experience? Click 'Activate Now'
                  to open the Shopify Theme Editor and add the Floating Cart Button
                  to your theme.
                </p>
              </CalloutCard>
            </div>
          </Layout.Section>

          {/* Intro Section */}
          <Layout.Section>
            <TextContainer>
              <DisplayText size="Large"><span>Introduction</span></DisplayText>
              <p>
                🚀 Welcome to Floating Cart Button by MeroxIO! Transform your
                Shopify store with a seamless, intuitive, and mobile-friendly
                cart experience.
              </p>
              <ul className="appFeatures">
                <li><strong>✅ Live Cart Updates – </strong> Real-time updates.</li>
                <li><strong>✅ Quick Cart Access – </strong> Instant drawer/page open.</li>
                <li><strong>✅ Mobile-Optimized – </strong> Designed for mobile users.</li>
                <li><strong>✅ Automatic Currency Adaptation – </strong> For global stores.</li>
                <li><strong>✅ Analytics Dashboard – </strong> Track cart interactions.</li>
                <li><strong>✅ Theme Compatibility – </strong> Works with all Shopify themes.</li>
                <li><strong>✅ Priority Support – </strong> Faster response for premium users.</li>
              </ul>
            </TextContainer>
          </Layout.Section>

          {/* Video Section */}
          <Layout.Section secondary>
            <Card>
              <div
                className="videoWrapper"
                style={{
                  backgroundImage: `url(${shopifyBackground})`,
                  padding: "22px",
                }}
              >
                <video
                  src="https://cdn.shopify.com/videos/c/o/v/9f176878242244b5a824915f62f4087b.mp4"
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{ width: "100%", height: "100%" }}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
