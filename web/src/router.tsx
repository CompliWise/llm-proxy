import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "./client";
import AppShell from "./components/app-shell";
import DefaultRedirect from "./components/default-redirect";
import RequireRole from "./components/require-role";
import ErrorBoundary from "./components/ui/error-boundary";
import { ADMIN_BASENAME } from "./lib/admin-path";
import CircuitPage from "./pages/circuit";
import ConfigPage from "./pages/config";
import CostPage from "./pages/cost";
import KeysPage from "./pages/keys";
import KeyDetailPage from "./pages/keys/detail";
import LoginPage from "./pages/login";
import ModelStatusPage from "./pages/model-status";
import OverviewPage from "./pages/overview";
import PIIPage from "./pages/pii";
import RateLimitsPage from "./pages/rate-limits";
import SharePage from "./pages/share";
import UsagePage from "./pages/usage";
import UsersPage from "./pages/users";

function shell(page: ReactNode) {
  return (
    <AppShell>
      <ErrorBoundary>{page}</ErrorBoundary>
    </AppShell>
  );
}

export default function Router() {
  const basename = window.location.pathname.startsWith(`${ADMIN_BASENAME}/`)
    ? ADMIN_BASENAME
    : undefined;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter
        basename={basename}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route element={<LoginPage />} path="/login" />
          <Route element={<SharePage />} path="/share/:id" />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <OverviewPage />
              </RequireRole>
            )}
            path="/"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <UsagePage />
              </RequireRole>
            )}
            path="/usage"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <CircuitPage />
              </RequireRole>
            )}
            path="/circuit"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <RateLimitsPage />
              </RequireRole>
            )}
            path="/rate-limits"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <CostPage />
              </RequireRole>
            )}
            path="/cost"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <PIIPage />
              </RequireRole>
            )}
            path="/pii"
          />
          <Route
            element={shell(
              <RequireRole minRole="editor">
                <ModelStatusPage />
              </RequireRole>
            )}
            path="/model-status"
          />
          <Route
            element={shell(
              <RequireRole minRole="admin">
                <ConfigPage />
              </RequireRole>
            )}
            path="/config"
          />
          <Route
            element={shell(
              <RequireRole minRole="viewer">
                <KeyDetailPage />
              </RequireRole>
            )}
            path="/keys/:key"
          />
          <Route
            element={shell(
              <RequireRole minRole="viewer">
                <KeysPage />
              </RequireRole>
            )}
            path="/keys"
          />
          <Route
            element={<Navigate replace to="/keys?request=1" />}
            path="/request-key"
          />
          <Route
            element={<Navigate replace to="/keys?tab=requests" />}
            path="/key-requests"
          />
          <Route
            element={shell(
              <RequireRole minRole="admin">
                <UsersPage />
              </RequireRole>
            )}
            path="/users"
          />
          <Route element={<DefaultRedirect />} path="*" />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
