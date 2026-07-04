import { lazy, Suspense, useMemo, useState } from "react";
import {
  assistantPrompt,
  codeExamples,
  scrubProxyKeyFromText,
} from "../../lib/code-examples";
import type { Provider } from "../../types";
import { CopyButton } from "../ui/copy-button";
import { N8nSetupGuidePanel } from "./n8n-setup-guide";

const CodeBlock = lazy(() =>
  import("../ui/code-block").then((m) => ({ default: m.CodeBlock }))
);

const CODE_SECRET_WARNING =
  "Don't paste this code into Cursor, Replit, or any other AI chat — it contains your real proxy key. Use the prompt below instead.";

function CodeBlockFallback({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre px-5 py-4 font-mono text-[#abb2bf] text-sm">
      {code}
    </pre>
  );
}

export interface ProxyKeyUsagePanelProps {
  baseUrl: string;
  /** When true, omit outer glass panels (e.g. nested inside key detail tabs). */
  embedded?: boolean;
  provider: Provider;
  proxyKey: string;
}

export function ProxyKeyUsagePanel({
  provider,
  baseUrl,
  proxyKey,
  embedded = false,
}: ProxyKeyUsagePanelProps) {
  const [activeTab, setActiveTab] = useState(0);

  const examples = useMemo(
    () => codeExamples({ provider, baseUrl, key: proxyKey }),
    [provider, baseUrl, proxyKey]
  );
  const prompt = useMemo(() => {
    const raw = assistantPrompt({ provider, baseUrl });
    return scrubProxyKeyFromText(raw, proxyKey);
  }, [provider, baseUrl, proxyKey]);

  const n8nTabIndex = examples.length;
  const isN8nTab = activeTab === n8nTabIndex;
  const active = isN8nTab ? null : (examples[activeTab] ?? examples[0]);
  const usageSectionClass = embedded
    ? "space-y-3"
    : "glass-panel overflow-hidden";
  const promptSectionClass = embedded
    ? "space-y-3"
    : "glass-panel overflow-hidden";

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      <section className={usageSectionClass}>
        <div
          className={
            embedded ? "space-y-1" : "border-base-300/70 border-b px-6 py-4"
          }
        >
          <h2 className={embedded ? "font-semibold text-sm" : "font-semibold"}>
            Drop-in usage
          </h2>
          <p className="text-base-content/60 text-sm">
            {isN8nTab
              ? "Point n8n at the proxy with a custom credential host — same models, same request shape."
              : `Point your existing ${provider} SDK at the proxy — same models, same request shape.`}
          </p>
        </div>

        <div
          className={`tabs tabs-bordered ${embedded ? "px-0 pt-1" : "px-4 pt-3"}`}
          role="tablist"
        >
          {examples.map((ex, i) => (
            <button
              aria-selected={i === activeTab}
              className={`tab ${i === activeTab ? "tab-active font-medium" : ""}`}
              key={ex.id}
              onClick={() => setActiveTab(i)}
              role="tab"
              type="button"
            >
              {ex.label}
            </button>
          ))}
          <button
            aria-selected={isN8nTab}
            className={`tab ${isN8nTab ? "tab-active font-medium" : ""}`}
            key="n8n"
            onClick={() => setActiveTab(n8nTabIndex)}
            role="tab"
            type="button"
          >
            n8n
          </button>
        </div>

        {isN8nTab ? (
          <div className={embedded ? "pt-2" : "p-4"}>
            <N8nSetupGuidePanel
              baseUrl={baseUrl}
              embedded={embedded}
              provider={provider}
              tabContent
            />
          </div>
        ) : active ? (
          <div className={embedded ? "space-y-3 pt-2" : "space-y-3 p-4"}>
            <div
              className="alert alert-error animate-code-secret-warning font-medium text-sm"
              role="alert"
            >
              <span>{CODE_SECRET_WARNING}</span>
            </div>
            <div className="relative rounded-xl bg-[#282c34] p-3 pt-11">
              <div className="absolute top-3 right-3 z-10">
                <CopyButton
                  className="btn btn-sm btn-primary gap-2 px-3 shadow-md"
                  label="Copy"
                  value={active.code}
                />
              </div>
              <div className="overflow-x-auto text-sm">
                <Suspense fallback={<CodeBlockFallback code={active.code} />}>
                  <CodeBlock code={active.code} language={active.language} />
                </Suspense>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className={promptSectionClass}>
        <div
          className={
            embedded
              ? "flex items-start justify-between gap-3"
              : "flex items-center justify-between border-base-300/70 border-b px-6 py-4"
          }
        >
          <div>
            <h2
              className={embedded ? "font-semibold text-sm" : "font-semibold"}
            >
              Prompt for Cursor / Replit / n8n / etc.
            </h2>
            <p className="text-base-content/60 text-sm">
              Safe to paste into an AI assistant — uses a placeholder for the
              key, not your real secret. Copy the key from above separately when
              the assistant asks.
            </p>
          </div>
          <CopyButton label="Copy prompt" value={prompt} />
        </div>
        <pre
          className={`overflow-x-auto whitespace-pre-wrap text-base-content/80 text-sm ${
            embedded ? "rounded-lg bg-base-300 px-4 py-3" : "px-6 py-4"
          }`}
        >
          {prompt}
        </pre>
      </section>
    </div>
  );
}
