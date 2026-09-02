import React from "react";
import ReactDOM from "react-dom/client";

import { ToastProvider } from "./components/ui/toast";
import "./index.css";
import { initTheme } from "./lib/theme";
import { StatsigAppProvider } from "./providers/statsig-provider";
import Router from "./router";

initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StatsigAppProvider>
      <ToastProvider>
        <Router />
      </ToastProvider>
    </StatsigAppProvider>
  </React.StrictMode>
);
