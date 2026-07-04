import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLogout, useMe } from "../hooks/queries";
import { navItemsForRole } from "../lib/nav";
import {
  setThemeAuto,
  toggleTheme,
  useTheme,
  useThemePreference,
} from "../lib/theme";
import LLMProxyLogo from "./llm-proxy-logo";
import { DataSourceKey } from "./ui/data-source";
import UserAvatar from "./user-avatar";

function ThemeToggle() {
  const theme = useTheme();
  const preference = useThemePreference();
  const isAuto = preference === "auto";
  const isDark = theme === "dark";

  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-start justify-between gap-2 px-2 py-1">
        <div className="min-w-0">
          <p className="text-base-content/70 text-sm">Dark / Light</p>
          <p className="text-[0.65rem] text-base-content/45">
            {isAuto ? `Auto · ${isDark ? "dark" : "light"} (system)` : "Manual"}
          </p>
        </div>
        <input
          aria-label="Automatically match system dark or light mode"
          checked={isAuto}
          className="toggle toggle-primary toggle-xs mt-0.5 shrink-0"
          onChange={(event) => setThemeAuto(event.target.checked)}
          type="checkbox"
        />
      </label>
      {isAuto ? null : (
        <button
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="btn btn-ghost btn-sm w-full justify-start gap-2 px-2 text-base-content/70"
          onClick={() => toggleTheme()}
          type="button"
        >
          {isDark ? (
            <svg
              className="h-4 w-4 fill-none stroke-current"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4 fill-none stroke-current"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
          )}
          {isDark ? "Switch to light" : "Switch to dark"}
        </button>
      )}
    </div>
  );
}

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center opacity-80">
      {children}
    </span>
  );
}

function DashboardIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="m11.5 11.5 7-7M16 6l2 2M19 3l2 2" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M3 3v18h18" />
      <path d="m7 14 3-4 3 3 4-6" />
    </svg>
  );
}

function CircuitIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 13a9 9 0 1 0-9 9h18a9 9 0 0 0-9-9Z" />
      <path d="M12 13 8 9" />
    </svg>
  );
}

function CostIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ModelStatusIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="m12 2 8 4.5v7L12 18l-8-4.5v-7L12 2Z" />
      <path d="m12 18 8-4.5" />
      <path d="M12 18V9" />
      <path d="m4 7.5 8 4.5" />
    </svg>
  );
}

function ConfigIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5.34 13H5.25a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 7 7.34l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 4.6h.09A1.65 1.65 0 0 0 13 5.34" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SidebarUserFooter({
  user,
  displayName,
  loggingOut,
  onLogout,
}: {
  user: ReturnType<typeof useMe>["data"];
  displayName: string;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <div className="mt-auto border-base-300/70 border-t p-4">
      <div className="flex items-center gap-3">
        <UserAvatar user={user} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-base-content text-sm">
            {displayName}
          </p>
          {user?.email ? (
            <p className="truncate text-base-content/60 text-xs">
              {user.email}
            </p>
          ) : null}
          {user?.role ? (
            <p className="mt-0.5 truncate text-[0.65rem] text-base-content/45 uppercase tracking-wide">
              {user.role}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2">
        <ThemeToggle />
      </div>
      <button
        className="btn btn-ghost btn-sm mt-1 w-full justify-start gap-2 px-2 text-base-content/70"
        disabled={loggingOut}
        onClick={onLogout}
        type="button"
      >
        {loggingOut ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <svg
            className="h-4 w-4 fill-none stroke-current"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        )}
        Log out
      </button>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: me } = useMe();
  const logout = useLogout();

  const onLogout = async () => {
    await logout.mutateAsync();
    window.location.href = "/admin/login";
  };

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const role = me?.role ?? "viewer";

  const navIcons: Record<string, React.ReactElement> = {
    "/": <DashboardIcon />,
    "/usage": <UsageIcon />,
    "/circuit": <CircuitIcon />,
    "/rate-limits": <GaugeIcon />,
    "/cost": <CostIcon />,
    "/pii": <ShieldIcon />,
    "/model-status": <ModelStatusIcon />,
    "/keys": <KeyIcon />,
    "/config": <ConfigIcon />,
    "/users": <UsersIcon />,
  };

  const { monitoring, manage } = navItemsForRole(role);
  const monitoringItems = monitoring.map((item) => ({
    ...item,
    icon: navIcons[item.to],
  }));
  const manageItems = manage.map((item) => ({
    ...item,
    icon: navIcons[item.to],
  }));

  const navSections: { heading: string; items: typeof monitoringItems }[] = [];
  if (monitoringItems.length > 0) {
    navSections.push({ heading: "Monitoring", items: monitoringItems });
  }
  if (manageItems.length > 0) {
    navSections.push({ heading: "Manage", items: manageItems });
  }

  const displayName = me?.name || me?.email?.split("@")[0] || "User";

  return (
    <div className="drawer lg:drawer-open">
      <input className="drawer-toggle" id="app-drawer" type="checkbox" />

      <div className="drawer-content flex min-h-screen flex-col bg-base-200">
        <div className="navbar sticky top-0 z-30 border-base-300/70 border-b bg-base-100/90 px-4 backdrop-blur-md lg:hidden">
          <div className="flex-none">
            <label
              aria-label="Open menu"
              className="btn btn-square btn-ghost btn-sm"
              htmlFor="app-drawer"
            >
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
              </svg>
            </label>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <LLMProxyLogo className="shadow-sm" size="sm" />
              <span className="font-semibold text-sm">LLM Proxy Admin</span>
            </div>
          </div>
        </div>

        <main className="flex-1 p-4 lg:p-8">
          <div className="page-shell">{children}</div>
        </main>
        <DataSourceKey />
      </div>

      <div className="drawer-side z-40">
        <label
          aria-label="Close menu"
          className="drawer-overlay"
          htmlFor="app-drawer"
        />
        <aside className="flex min-h-full w-72 flex-col border-base-300/70 border-r bg-base-100 text-base-content">
          <div className="border-base-300/70 border-b px-6 py-6">
            <div className="flex items-center gap-3">
              <LLMProxyLogo />
              <div>
                <p className="font-semibold text-base leading-tight">
                  LLM Proxy
                </p>
                <p className="text-base-content/50 text-xs uppercase tracking-[0.18em]">
                  Admin Console
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {navSections.map((section) => (
              <div className="mb-4" key={section.heading}>
                <p className="px-3 pb-1 font-semibold text-[0.65rem] text-base-content/40 uppercase tracking-[0.16em]">
                  {section.heading}
                </p>
                <ul className="menu w-full gap-1 p-0">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      <Link
                        className={`rounded-xl transition-colors ${isActive(item.to) ? "bg-primary/10 font-medium text-primary" : "hover:bg-base-200/80"}`}
                        to={item.to}
                      >
                        <NavIcon>{item.icon}</NavIcon>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <SidebarUserFooter
            displayName={displayName}
            loggingOut={logout.isPending}
            onLogout={onLogout}
            user={me}
          />
        </aside>
      </div>
    </div>
  );
}
