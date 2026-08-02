import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Capacitor } from "@capacitor/core";
import { queryPersister } from "./lib/persistence";
import App from "./App";
import "./index.css";

if (window.anttodoDesktop) {
  document.body.classList.add("is-electron");
  if (window.anttodoDesktop.platform === "darwin") {
    document.body.classList.add("is-macos");
  }
}

if (Capacitor.isNativePlatform()) {
  document.body.classList.add("is-capacitor", `is-${Capacitor.getPlatform()}`);
}

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === "success",
        },
      }}
    >
      {window.anttodoDesktop?.platform === "darwin" && (
        <div className="window-traffic-lights" aria-label="窗口控制">
          <button
            className="traffic-light close"
            aria-label="关闭窗口"
            onClick={() => window.anttodoDesktop?.windowControls.close()}
          />
          <button
            className="traffic-light minimize"
            aria-label="最小化窗口"
            onClick={() => window.anttodoDesktop?.windowControls.minimize()}
          />
          <button
            className="traffic-light fullscreen"
            aria-label="进入或退出全屏"
            onClick={() => window.anttodoDesktop?.windowControls.toggleFullScreen()}
          />
        </div>
      )}
      <div className="window-drag-strip" aria-hidden="true" />
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
