import { LogLevel, StatsigProvider } from "@statsig/react-bindings";
import { StatsigSessionReplayPlugin } from "@statsig/session-replay";
import { StatsigAutoCapturePlugin } from "@statsig/web-analytics";
import { type ReactNode, useMemo } from "react";

interface StatsigAppProviderProps {
  children: ReactNode;
}

const STATSIG_CLIENT_KEY = import.meta.env.STATSIG_CLIENT_KEY ?? "";
const STATSIG_ENVIRONMENT = import.meta.env.DEV
  ? "development"
  : "production";
const STATSIG_DEVICE_ID_STORAGE_KEY = "statsig:deviceID:v1";

function resolveDeviceId(): string | undefined {
  try {
    const existing = window.localStorage
      .getItem(STATSIG_DEVICE_ID_STORAGE_KEY)
      ?.trim();
    if (existing) {
      return existing;
    }

    const created = crypto.randomUUID();
    window.localStorage.setItem(STATSIG_DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return;
  }
}

function buildStatsigUser() {
  const customIDs: Record<string, string> = {};
  const deviceID = resolveDeviceId();
  if (deviceID) {
    customIDs.deviceID = deviceID;
    customIDs.stableID = deviceID;
  }

  return {
    custom: { app: "llm-proxy-web" },
    ...(Object.keys(customIDs).length > 0 ? { customIDs } : {}),
    userID: "llm-proxy-admin",
  };
}

/**
 * SaaS client SDK for the llm-proxy admin UI: session replay + autocapture.
 * Children render unchanged when STATSIG_CLIENT_KEY is unset.
 */
export function StatsigAppProvider({ children }: StatsigAppProviderProps) {
  const plugins = useMemo(
    () => [
      new StatsigSessionReplayPlugin({
        rrwebConfig: { maskAllInputs: true },
      }),
      new StatsigAutoCapturePlugin(),
    ],
    []
  );

  if (!STATSIG_CLIENT_KEY) {
    return children;
  }

  return (
    <StatsigProvider
      options={{
        environment: { tier: STATSIG_ENVIRONMENT },
        logLevel: import.meta.env.DEV ? LogLevel.Debug : LogLevel.Warn,
        plugins,
      }}
      sdkKey={STATSIG_CLIENT_KEY}
      user={buildStatsigUser()}
    >
      {children}
    </StatsigProvider>
  );
}
