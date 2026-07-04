import { useMemo } from "react";

import { n8nSetupGuide } from "../../lib/n8n-setup";
import type { Provider } from "../../types";

export interface N8nSetupGuideProps {
  baseUrl: string;
  embedded?: boolean;
  provider: Provider;
  /** When true, render tab body only (no outer section chrome). */
  tabContent?: boolean;
}

export function N8nSetupGuidePanel({
  provider,
  baseUrl,
  embedded = false,
  tabContent = false,
}: N8nSetupGuideProps) {
  const guide = useMemo(
    () => n8nSetupGuide(provider, baseUrl),
    [provider, baseUrl]
  );
  if (!guide) {
    return null;
  }

  const body = (
    <div
      className={
        tabContent ? "space-y-4" : embedded ? "space-y-4 pt-1" : "space-y-5 p-6"
      }
    >
      {tabContent ? null : (
        <p className="text-base-content/60 text-sm">
          Point n8n&apos;s {guide.credentialLabel} credential at the proxy —
          same models, same request shape.
        </p>
      )}
      <ol className="list-decimal space-y-2 pl-5 text-base-content/80 text-sm">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {guide.note ? (
        <div className="alert alert-warning text-sm">
          <span>{guide.note}</span>
        </div>
      ) : null}

      {guide.credentialImage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="space-y-2">
            <figcaption className="font-medium text-base-content/50 text-xs uppercase tracking-wide">
              Credential{guide.urlField ? ` — ${guide.urlField}` : ""}
            </figcaption>
            <div className="overflow-hidden rounded-xl border border-base-300/70 bg-base-100 shadow-sm">
              <img
                alt={`n8n ${guide.credentialLabel} credential with ${guide.urlField ?? "proxy URL"} set to the proxy`}
                className="w-full"
                loading="lazy"
                src={guide.credentialImage}
              />
            </div>
          </figure>

          {guide.nodeImage ? (
            <figure className="space-y-2">
              <figcaption className="font-medium text-base-content/50 text-xs uppercase tracking-wide">
                Workflow node — credential picker
              </figcaption>
              <div className="overflow-hidden rounded-xl border border-base-300/70 bg-base-100 shadow-sm">
                <img
                  alt={`n8n ${guide.nodeLabel} node credential selection`}
                  className="w-full"
                  loading="lazy"
                  src={guide.nodeImage}
                />
              </div>
            </figure>
          ) : (
            <div className="flex items-center rounded-xl border border-base-300/70 border-dashed bg-base-200/30 px-5 py-6 text-base-content/60 text-sm">
              Add a <span className="mx-1 font-medium">{guide.nodeLabel}</span>{" "}
              node in your workflow and select the credential you created above.
            </div>
          )}
        </div>
      ) : null}

      {guide.credentialImage ? (
        <p className="text-base-content/50 text-xs">
          Replace the example host in the screenshots with{" "}
          <code className="rounded bg-base-200/70 px-1.5 py-0.5 font-mono">
            {baseUrl}
          </code>
          . n8n&apos;s credential test can fail while live workflows still
          succeed.
        </p>
      ) : null}
    </div>
  );

  if (tabContent) {
    return body;
  }

  const sectionClass = embedded ? "space-y-3" : "glass-panel overflow-hidden";

  return (
    <section className={sectionClass}>
      <div
        className={
          embedded ? "space-y-1" : "border-base-300/70 border-b px-6 py-4"
        }
      >
        <h2 className={embedded ? "font-semibold text-sm" : "font-semibold"}>
          n8n setup
        </h2>
      </div>
      {body}
    </section>
  );
}
