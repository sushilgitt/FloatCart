const fs = require("fs");
const path = require("path");

const cliPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@shopify",
  "cli",
  "dist",
  "index.js",
);

if (!fs.existsSync(cliPath)) {
  console.warn("[patch-shopify-cli] Shopify CLI not found, skipping patch.");
  process.exit(0);
}

let source = fs.readFileSync(cliPath, "utf8");

let changed = false;

const replacements = [
  {
    from: /let apiKey = remoteApp\.apiKey, apiSecret = remoteApp\.apiSecretKeys\[0\]\?\.secret \?\? "", appPreviewUrl = await buildAppURLForWeb\(storeFqdn, apiKey\), env4 = getEnvironmentVariables\(\), shouldRenderGraphiQL = !isTruthy\(env4\[environmentVariableNames\.disableGraphiQLExplorer\]\), reloadedApp = await reloadApp\(localApp\), appWatcher = new AppEventWatcher\(reloadedApp, network\.proxyUrl\), anyPreviewableExtensions = reloadedApp\.allExtensions\.some\(\(ext\) => ext\.isPreviewable\), devConsoleURL = `\$\{network\.proxyUrl\}\/extensions\/dev-console`, previewURL = anyPreviewableExtensions \? devConsoleURL : appPreviewUrl, graphiqlURL = shouldRenderGraphiQL \? `http:\/\/localhost:\$\{graphiqlPort\}\/graphiql\$\{graphiqlKey \? `\?key=\$\{graphiqlKey\}` : ""\}` : void 0, devSessionStatusManager = new DevSessionStatusManager\(\{ isReady: !1, previewURL, graphiqlURL \}\), processes = \[/,
    to: 'let apiKey = remoteApp.apiKey, apiSecret = remoteApp.apiSecretKeys[0]?.secret ?? "", appPreviewUrl = await buildAppURLForWeb(storeFqdn, apiKey), env4 = getEnvironmentVariables(), shouldRenderGraphiQL = !isTruthy(env4[environmentVariableNames.disableGraphiQLExplorer]), reloadedApp = await reloadApp(localApp), appWatcher = new AppEventWatcher(reloadedApp, network.proxyUrl), anyPreviewableExtensions = reloadedApp.allExtensions.some((ext) => ext.isPreviewable), devConsoleURL = `${network.proxyUrl}/extensions/dev-console`, shouldRunDevSession = developerPlatformClient.supportsDevSessions && anyPreviewableExtensions, previewURL = anyPreviewableExtensions ? devConsoleURL : appPreviewUrl, graphiqlURL = shouldRenderGraphiQL ? `http://localhost:${graphiqlPort}/graphiql${graphiqlKey ? `?key=${graphiqlKey}` : ""}` : void 0, devSessionStatusManager = new DevSessionStatusManager({ isReady: !shouldRunDevSession, previewURL, graphiqlURL, statusMessage: shouldRunDevSession ? void 0 : DevSessionStaticMessages.READY }), processes = [',
  },
  {
    from: "    developerPlatformClient.supportsDevSessions ? await setupDevSessionProcess({",
    to: "    shouldRunDevSession ? await setupDevSessionProcess({",
  },
  {
    from: "    }) : await setupDraftableExtensionsProcess({",
    to: "    }) : developerPlatformClient.supportsDevSessions ? void 0 : await setupDraftableExtensionsProcess({",
  },
  {
    from: "    }), shouldUpdateURLs && (developerPlatformClient.supportsDevSessions ? localApp.setDevApplicationURLs(newURLs) : await updateURLs(newURLs, apiKey, developerPlatformClient, localApp));",
    to: "    }), shouldUpdateURLs && (developerPlatformClient.supportsDevSessions ? (localApp.setDevApplicationURLs(newURLs), await updateURLs(newURLs, apiKey, developerPlatformClient, localApp)) : await updateURLs(newURLs, apiKey, developerPlatformClient, localApp));",
  },
];

for (const replacement of replacements) {
  const nextSource = source.replace(replacement.from, replacement.to);
  if (nextSource !== source) {
    source = nextSource;
    changed = true;
  }
}

if (!changed) {
  console.log("[patch-shopify-cli] Patch already applied or not needed.");
  process.exit(0);
}

fs.writeFileSync(cliPath, source);
console.log("[patch-shopify-cli] Applied local dev-session compatibility patch.");
