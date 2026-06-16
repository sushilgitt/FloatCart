import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";

// Vite 2.x predefines __dirname via esbuild so we use a different name
const _configDir = dirname(fileURLToPath(import.meta.url));
process.env = { ...process.env, ...loadEnv("", process.cwd()) };

console.log("API key: ", process.env.SHOPIFY_API_KEY);
console.log("Host: ", process.env.HOST);

const proxyOptions = {
  target: `http://127.0.0.1:${process.env.BACKEND_PORT}`,
  changeOrigin: false,
  secure: true,
  ws: false,
};

const host = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";

let hmrConfig;
if (host === "localhost") {
  hmrConfig = { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 };
} else {
  hmrConfig = { protocol: "wss", host, port: process.env.FRONTEND_PORT, clientPort: 443 };
}

const bridgeCorePath = resolve(
  _configDir,
  "node_modules/@shopify/app-bridge-core"
);

const simpleActions = [
  "AuthCode", "Button", "ButtonGroup", "Cart", "Client", "Error", "Toast",
  "Features", "FeedbackModal", "Fullscreen", "LeaveConfirmation", "Loading",
  "Print", "ResourcePicker", "Scanner", "SessionToken", "TitleBar",
  "ContextualSaveBar", "Share", "Pos", "MarketingExternalActivityTopBar",
  "Performance", "Picker", "WebVitals",
];

const nestedActions = [
  "Modal/ModalContent", "Modal", "Navigation/History", "Navigation/Redirect",
  "Menu/NavigationMenu", "Menu/ChannelMenu", "Link/AppLink",
];

const bridgeCoreAlias = simpleActions.map((name) => ({
  find: "@shopify/app-bridge-core/actions/" + name,
  replacement: resolve(bridgeCorePath, "actions", name, "index.js"),
}));

nestedActions.forEach((name) => {
  bridgeCoreAlias.push({
    find: "@shopify/app-bridge-core/actions/" + name,
    replacement: resolve(bridgeCorePath, "actions", ...name.split("/"), "index.js"),
  });
});

export default defineConfig({
  root: _configDir,
  plugins: [react()],
  define: {
    "process.env.SHOPIFY_API_KEY": JSON.stringify(process.env.SHOPIFY_API_KEY),
  },
  resolve: {
    preserveSymlinks: true,
    alias: bridgeCoreAlias,
  },
  server: {
    host: "localhost",
    port: process.env.FRONTEND_PORT,
    hmr: hmrConfig,
    proxy: {
      "^/(\\?.*)?$": proxyOptions,
      "^/api(/|(\\?.*)?$)": proxyOptions,
    },
  },
});
