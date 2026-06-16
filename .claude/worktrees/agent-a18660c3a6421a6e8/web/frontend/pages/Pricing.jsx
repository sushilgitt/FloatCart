import React, { useEffect, useMemo, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Button,
  Frame,
  Icon,
  Banner,
  Badge,
  Stack,
  SkeletonPage,
  SkeletonBodyText,
  Modal,
  TextContainer,
} from "@shopify/polaris";
import { CircleTickMinor, CancelSmallMinor } from "@shopify/polaris-icons";
import { Redirect } from "@shopify/app-bridge/actions";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useAuthenticatedFetch } from "../hooks";

export default function Pricing() {
  const app = useAppBridge();
  const fetchAuth = useAuthenticatedFetch();
  const redirect = Redirect.create(app);

  const tick = useMemo(() => <Icon source={CircleTickMinor} color="success" />, []);
  const cross = useMemo(() => <Icon source={CancelSmallMinor} color="subdued" />, []);

  const [serverTier, setServerTier] = useState(null);
  const [loading, setLoading] = useState({ page: true, action: null });
  const [confirm, setConfirm] = useState({ open: false, target: null, title: "", message: "" });
  const [banner, setBanner] = useState({ msg: "", status: null });

  const planPrices = {
    free: "0.00",
    basic: "10.00",
    premium: "100.00",
  };

  const selectedPlan = useMemo(() => {
    if (!serverTier) return null;
    if (serverTier === "free") return "free";
    if (serverTier === "premium") return "basic";
    if (serverTier === "unlimited") return "premium";
    return "free";
  }, [serverTier]);

  async function refreshTier() {
    try {
      setLoading((s) => ({ ...s, page: true }));
      const res = await fetchAuth("/api/hasActiveSubscription");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to fetch subscription");
      if (["free", "premium", "unlimited"].includes(data?.tier)) {
        setServerTier(data.tier);
      } else {
        setServerTier(data?.hasActiveSubscription ? "premium" : "free");
      }
    } catch (e) {
      console.error(e);
      setServerTier("free");
      setBanner({ msg: "Failed to fetch subscription status.", status: "critical" });
    } finally {
      setLoading((s) => ({ ...s, page: false }));
    }
  }

  useEffect(() => {
    refreshTier();
  }, []);

  const openConfirm = (targetPlan) => {
    if (targetPlan === selectedPlan) {
      setBanner({
        msg: `You’re already on the ${labelOf(targetPlan)} plan.`,
        status: "warning",
      });
      return;
    }

    if (targetPlan === "free") {
      setConfirm({
        open: true,
        target: "free",
        title: "Switch to Free plan?",
        message:
          "You’ll cancel your current subscription and move to the Free plan. Some advanced features will be disabled.",
      });
      return;
    }

    const title =
      targetPlan === "basic" ? "Upgrade to Basic?" : "Upgrade to Premium?";
    const message =
      targetPlan === "basic"
        ? "Basic enables customization settings and design changes. Product total price & Design 2 button remain disabled."
        : "Premium unlocks all features, including total product price and Design 2 button.";
    setConfirm({ open: true, target: targetPlan, title, message });
  };

  const runConfirm = async () => {
    const target = confirm.target;
    setConfirm((c) => ({ ...c, open: false }));
    await changePlan(target);
  };

  const changePlan = async (targetPlan) => {
    if (!targetPlan) return;
    try {
      setLoading((s) => ({ ...s, action: targetPlan }));

      if (targetPlan === "free") {
        const res = await fetchAuth("/api/cancelSubscription");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Cancel failed");
        if (data?.status && data?.status !== "No subscription found") {
          setBanner({ msg: "Subscription cancelled. You’re on Free.", status: "success" });
        } else {
          setBanner({ msg: "No active subscription found.", status: "warning" });
        }
        await refreshTier();
        return;
      }

      const backendPlan = targetPlan === "basic" ? "premium" : "unlimited";
      const res = await fetchAuth(`/api/createSubscription?plan=${backendPlan}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Create subscription failed");

      if (data?.isActiveSubscription) {
        await refreshTier();
        setBanner({
          msg: `${labelOf(targetPlan)} plan is already active.`,
          status: "success",
        });
      } else if (data?.confirmationUrl) {
        setBanner({ msg: "Redirecting to Shopify billing page…", status: "success" });
        redirect.dispatch(Redirect.Action.REMOTE, String(data.confirmationUrl));
      } else {
        throw new Error("No confirmationUrl returned.");
      }
    } catch (e) {
      console.error(e);
      setBanner({
        msg:
          targetPlan === "free"
            ? "Failed to cancel subscription."
            : "Failed to create subscription.",
        status: "critical",
      });
    } finally {
      setLoading((s) => ({ ...s, action: null }));
    }
  };

  const isCurrent = (plan) => selectedPlan === plan;
  const labelOf = (plan) =>
    plan === "free" ? "Free" : plan === "basic" ? "Basic" : "Premium";

  const Feature = ({ enabled, children }) => (
    <Stack spacing="tight" alignment="center">
      {enabled ? tick : cross}
      <span style={{ color: "#111" }}>{children}</span>
    </Stack>
  );

  if (loading.page && !selectedPlan) {
    return (
      <Frame>
        <SkeletonPage title="Plans" primaryAction>
          <Layout>
            {[1, 2, 3].map((k) => (
              <Layout.Section oneThird key={k}>
                <Card sectioned>
                  <SkeletonBodyText lines={6} />
                </Card>
              </Layout.Section>
            ))}
          </Layout>
        </SkeletonPage>
      </Frame>
    );
  }

  const commonCardStyle = {
    borderRadius: 12,
    border: "1px solid #E3E3E3",
    position: "relative",
    overflow: "hidden",
  };
  const glowIfCurrent = (plan) =>
    isCurrent(plan)
      ? { boxShadow: "0 10px 30px rgba(37,99,235,0.25)", border: "2px solid #2563EB" }
      : {};

  const FreeWatermark = () => (
    <div
      style={{
        position: "absolute",
        top: "40%",
        left: "-15%",
        transform: "rotate(-30deg)",
        fontSize: "48px",
        color: "rgba(0,0,0,0.06)",
        fontWeight: "700",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      Free plan
    </div>
  );

  // Custom badge styles
  const customBadge = {
    backgroundColor: "#007a5c", // soft green background like 'Popular'
    color: "white",
    borderRadius: "12px",
    padding: "2px 12px",
     display: "flex",
  justifyContent: "center",
  alignItems: "center",

  };

  const currentBadge = {
    backgroundColor: "#2563EB", // blue background
    color: "#FFFFFF", // white text
    borderRadius: " 12px",
    padding: "2px 8px",
         display: "flex",
  justifyContent: "center",
  alignItems: "center",
  };

  return (
    <Frame>
      <Modal
        open={confirm.open}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
        title={confirm.title}
        primaryAction={{
          content:
            confirm.target === "free"
              ? "Yes, switch to Free"
              : `Subscribe for $${planPrices[confirm.target]} / month`,
          onAction: runConfirm,
          loading: loading.action === confirm.target,
          destructive: confirm.target === "free",
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirm((c) => ({ ...c, open: false })) }]}
      >
        <Modal.Section>
          <TextContainer>
            <p>{confirm.message}</p>
          </TextContainer>
        </Modal.Section>
      </Modal>

      <Page title="Floating Cart Button – Plans" subtitle="Pick a plan that fits your store.">
        {!!banner.msg && !!banner.status && (
          <Banner status={banner.status} onDismiss={() => setBanner({ msg: "", status: null })}>
            {banner.msg}
          </Banner>
        )}

        <Layout>
          {/* FREE */}
          <Layout.Section oneThird>
            <Card
              sectioned
              style={{ ...commonCardStyle, ...glowIfCurrent("free") }}
              title={
                <Stack alignment="center" spacing="tight">
                  <span>Free</span>
                  <span style={customBadge}>Starter</span>
                  {isCurrent("free") && <span style={currentBadge}>Current</span>}
                </Stack>
              }
            >
              <FreeWatermark />
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>$0</div>
              <p style={{ color: "var(--p-text-subdued)" }}>
                Customization disabled • Design change disabled • Product total price hidden • Design 2 button disabled
              </p>

              <div style={{ height: 12 }} />
              <Stack vertical spacing="loose">
                <Feature enabled={true}>Watermark enabled</Feature>
                <Feature enabled={false}>Customization settings</Feature>
                <Feature enabled={false}>Design change</Feature>
                <Feature enabled={false}>Product total price</Feature>
                <Feature enabled={false}>Design 2 button</Feature>
              </Stack>

              <div style={{ height: 16 }} />
              <Stack distribution="equalSpacing">
                <Button
                  destructive
                  onClick={() => openConfirm("free")}
                  disabled={isCurrent("free") || loading.action === "free"}
                  loading={loading.action === "free"}
                >
                  {isCurrent("free") ? "Current plan" : "Switch to Free"}
                </Button>
              </Stack>
            </Card>
          </Layout.Section>

          {/* BASIC */}
          <Layout.Section oneThird>
            <Card
              sectioned
              style={{ ...commonCardStyle, ...glowIfCurrent("basic") }}
              title={
                <Stack alignment="center" spacing="tight">
                  <span>Basic</span>
                  <span style={customBadge}>Popular</span>
                  {isCurrent("basic") && <span style={currentBadge}>Current</span>}
                </Stack>
              }
            >
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>$10</div>
              <p style={{ color: "var(--p-text-subdued)" }}>
                Customization enabled • Design change enabled • Product total price hidden • Design 2 button disabled
              </p>

              <div style={{ height: 12 }} />
              <Stack vertical spacing="loose">
                <Feature enabled={false}>Watermark disabled</Feature>
                <Feature enabled={true}>Customization settings</Feature>
                <Feature enabled={true}>Design change</Feature>
                <Feature enabled={false}>Product total price</Feature>
                <Feature enabled={false}>Design 2 button</Feature>
              </Stack>

              <div style={{ height: 16 }} />
              <Stack distribution="equalSpacing">
                <Button
                  primary
                  onClick={() => openConfirm("basic")}
                  disabled={isCurrent("basic") || loading.action === "basic"}
                  loading={loading.action === "basic"}
                >
                  {isCurrent("basic") ? "Basic Active" : "Upgrade to Basic"}
                </Button>
              </Stack>
            </Card>
          </Layout.Section>

          {/* PREMIUM */}
          <Layout.Section oneThird>
            <Card
              sectioned
              style={{ ...commonCardStyle, ...glowIfCurrent("premium") }}
              title={
                <Stack alignment="center" spacing="tight">
                  <span>Premium</span>
                  <span style={customBadge}>Full features</span>
                  {isCurrent("premium") && <span style={currentBadge}>Current</span>}
                </Stack>
              }
            >
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>$100</div>
              <p style={{ color: "var(--p-text-subdued)" }}>
                Customization enabled • Design change enabled • Product total price shown • Design 2 button enabled
              </p>

              <div style={{ height: 12 }} />
              <Stack vertical spacing="loose">
                <Feature enabled={false}>Watermark disabled</Feature>
                <Feature enabled={true}>Customization settings</Feature>
                <Feature enabled={true}>Design change</Feature>
                <Feature enabled={true}>Product total price</Feature>
                <Feature enabled={true}>Design 2 button</Feature>
              </Stack>

              <div style={{ height: 16 }} />
              <Stack distribution="equalSpacing">
                <Button
                  primary
                  onClick={() => openConfirm("premium")}
                  disabled={isCurrent("premium") || loading.action === "premium"}
                  loading={loading.action === "premium"}
                >
                  {isCurrent("premium") ? "Premium Active" : "Upgrade to Premium"}
                </Button>
              </Stack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
