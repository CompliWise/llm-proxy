import { Link } from "react-router-dom";
import { useMe } from "../../hooks/queries";
import { featureEnabled, featureLabel, featureMeta } from "../../lib/features";
import { permissions } from "../../lib/permissions";
import type { ConfigSummary } from "../../types";
import { StatusBadge } from "./page-header";

export function FeatureFlagList({
  features,
  linkToConfig,
}: {
  features: ConfigSummary["features"] | undefined;
  linkToConfig?: boolean;
}) {
  const { data: me } = useMe();
  const showConfigLink =
    (linkToConfig ?? true) && permissions.canManageConfigPage(me?.role);
  const rows = Object.entries(features ?? {}).map(([name, feature]) => ({
    name,
    label: featureLabel(name),
    enabled: featureEnabled(feature),
    meta: featureMeta(feature),
  }));

  if (rows.length === 0) {
    return (
      <p className="text-base-content/50 text-sm">No feature flags reported.</p>
    );
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <div className="space-y-3">
      <p className="text-base-content/70 text-sm">
        <span className="font-medium text-base-content">{enabledCount}</span> of{" "}
        <span className="font-medium text-base-content">{rows.length}</span>{" "}
        features enabled
      </p>
      <ul className="divide-y divide-base-300/50 rounded-xl border border-base-300/60 bg-base-100/40">
        {rows.map((row) => (
          <li
            className="flex items-center justify-between gap-3 px-3 py-2.5"
            key={row.name}
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-sm capitalize">
                {row.label}
              </div>
              <div className="truncate text-base-content/50 text-xs">
                {row.meta}
              </div>
            </div>
            <StatusBadge
              active={row.enabled}
              activeLabel="On"
              inactiveLabel="Off"
            />
          </li>
        ))}
      </ul>
      {showConfigLink ? (
        <Link className="btn btn-ghost btn-xs" to="/config">
          Full configuration
        </Link>
      ) : null}
    </div>
  );
}
