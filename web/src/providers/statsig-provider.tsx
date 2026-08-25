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
      user={{
        custom: { app: "llm-proxy-web" },
        userID: "llm-proxy-admin",
      }}
    >
      {children}
    </StatsigProvider>
  );
}
