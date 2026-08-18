import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as Sentry from "@sentry/react";
import { Capacitor } from "@capacitor/core";
import { createQueryPersister } from "./lib/persistence";
import { bootstrapInstanceConfig, currentBrandName } from "./lib/instanceConfig";
import { configureSupabase } from "./lib/supabase";
import { initializeSentry } from "./instrument";
import {
  applyThemePreference,
  loadThemePreference,
  subscribeSystemTheme,
} from "./lib/themePreference";
import App from "./App";
import "./index.css";

applyThemePreference(loadThemePreference());
subscribeSystemTheme(() => {
  const preference = loadThemePreference();
  if (preference.followSystem) {
    applyThemePreference(preference);
  }
});

if (window.anttodoDesktop) {
  document.body.classList.add("is-electron");
  if (window.anttodoDesktop.platform === "darwin") {
    document.body.classList.add("is-macos");
  }
}

const isTraySurface = window.location.hash.replace(/^#/, "").split("?")[0] === "/tray"
  || window.location.hash.replace(/^#/, "").split("?")[0] === "tray";

if (isTraySurface) {
  document.body.classList.add("is-tray");
}

if (Capacitor.isNativePlatform()) {
  document.body.classList.add("is-capacitor", `is-${Capacitor.getPlatform()}`);
}

async function bootstrap() {
  let instanceConfig = null;
  try {
    instanceConfig = await bootstrapInstanceConfig();
  } catch (error) {
    console.warn("Unable to load AntTodo instance configuration", error);
  }
  document.title = currentBrandName(instanceConfig);
  configureSupabase(instanceConfig);
  if (instanceConfig) {
    await window.anttodoDesktop?.auth.setServiceOrigin(instanceConfig.appUrl);
  }
  initializeSentry(instanceConfig);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: 1,
        networkMode: "offlineFirst",
      },
      mutations: {
        networkMode: "online",
      },
    },
  });
  const queryPersister = createQueryPersister(instanceConfig?.namespace);

  createRoot(document.getElementById("root")!, {
    onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
      console.warn("Uncaught error", error, errorInfo.componentStack);
    }),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }).render(
    <StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
        buster: "workspace-bundle-unified-task-tree-v1",
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            if (query.state.status !== "success") return false;
            if ((window.anttodoDesktop || Capacitor.isNativePlatform())
              && query.queryKey[0] === "workspace-bundle") {
              return false;
            }
            return true;
          },
        },
        }}
      >
      {!window.anttodoDesktop || isTraySurface ? null : window.anttodoDesktop.platform === "darwin" ? (
        <div className="window-traffic-lights" aria-label="窗口控制">
          <button
            type="button"
            className="traffic-light close"
            aria-label="关闭窗口"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.anttodoDesktop?.windowControls?.close();
            }}
          />
          <button
            type="button"
            className="traffic-light minimize"
            aria-label="最小化窗口"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.anttodoDesktop?.windowControls?.minimize();
            }}
          />
          <button
            type="button"
            className="traffic-light fullscreen"
            aria-label="进入或退出全屏"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.anttodoDesktop?.windowControls?.toggleFullScreen();
            }}
          />
        </div>
      ) : null}
      {!isTraySurface && <div className="window-drag-strip" aria-hidden="true" />}
        <App />
      </PersistQueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
