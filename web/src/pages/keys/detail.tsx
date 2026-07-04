import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BarChart, ChartCard } from "../../components/charts";
import { chartPalette } from "../../components/charts/chart-setup";
import KeyDetailPolicyEditor from "../../components/keys/key-detail-policy-editor";
import {
  KeyCostEventsTable,
  KeyPiiEventsTable,
  KeyRateUsageTable,
} from "../../components/keys/key-detail-tables";
import { ProxyKeyUsagePanel } from "../../components/keys/proxy-key-usage-panel";
import { CopyButton } from "../../components/ui/copy-button";
import {
  type DataSource,
  DataSourceBadge,
  LiveStat,
  rateLimitUsageSource,
} from "../../components/ui/data-source";
import { MaskedCredentialId } from "../../components/ui/masked-credential-id";
import { MaskedKey } from "../../components/ui/masked-key";
import PageHeader, {
  ErrorAlert,
  LiveIndicator,
  LoadingBlock,
  ProviderBadge,
  StatusBadge,
} from "../../components/ui/page-header";
import {
  SpendOverview,
  SpendPeriodPanel,
} from "../../components/ui/spend-breakdown";
import { useToast } from "../../components/ui/toast";
import {
  useKey,
  useKeyStats,
  useMe,
  usePII,
  useRateLimits,
  useUpdateKey,
} from "../../hooks/queries";
import { DAILY_HISTORY_SUBTITLE } from "../../lib/daily-history";
import {
  effectiveDailyLimitCents,
  effectiveMonthlyLimitCents,
  formatDailyCostLimit,
  formatMonthlyCostLimit,
  formatMonthYear,
  formatUsd,
  isPersonalKey,
  keyCostLimitPeriod,
  maskKeyId,
} from "../../lib/format";
import {
  decodeKeyRouteParam,
  isKeyRouteParam,
  isMaskedKeyRouteParam,
  isProxyKey,
  keyDetailPath,
} from "../../lib/key-routes";
import {
  dismissKeySetup,
  isKeySetupDismissed,
} from "../../lib/key-setup-dismiss";
import {
  rateLimitOverrideForKey,
  rateLimitUsageForKey,
} from "../../lib/key-stats";
import { permissions } from "../../lib/permissions";
import type { KeyStatsSource } from "../../types";

type DetailTab = "cost" | "pii" | "rate-limits" | "usage";

function piiLabel(value: boolean | null | undefined): string {
  if (value === true) {
    return "On";
  }
  if (value === false) {
    return "Off";
  }
  return "Inherit";
}

function formatLimit(value?: number): string {
  return value && value > 0 ? value.toLocaleString() : "∞";
}

function statsSource(source: KeyStatsSource): DataSource {
  return source;
}

function chartLabels(points: { day: string }[]): string[] {
  return points.map((p) => p.day.slice(5));
}

function detailTabClass(active: boolean): string {
  return active
    ? "btn btn-primary btn-sm gap-2 shadow-sm"
    : "btn btn-ghost btn-sm gap-2 text-base-content/70 hover:bg-base-200/70 hover:text-base-content";
}

export default function KeyDetailPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const { key: keyParam } = useParams<{ key: string }>();
  const { data: me } = useMe();
  const isViewer = permissions.isViewer(me?.role);
  const canManagePolicy = permissions.canManageKeyPolicy(me?.role);
  const routeKeyId = keyParam ? decodeKeyRouteParam(keyParam) : undefined;
  const validRoute = isKeyRouteParam(routeKeyId) ? routeKeyId : undefined;

  const keyQuery = useKey(validRoute);
  const statsQuery = useKeyStats(validRoute);
  const updateKey = useUpdateKey();
  const piiQuery = usePII();
  const rateQuery = useRateLimits();
  const [tab, setTab] = useState<DetailTab>("cost");
  const tabDefaultedRef = useRef(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const keyRecord = keyQuery.data;
  const proxyKey = keyRecord?.key;
  const [setupDismissed, setSetupDismissed] = useState(() =>
    proxyKey ? isKeySetupDismissed(proxyKey) : false
  );

  useEffect(() => {
    if (!proxyKey) {
      return;
    }
    setSetupDismissed(isKeySetupDismissed(proxyKey));
  }, [proxyKey]);

  useEffect(() => {
    if (
      !(routeKeyId && isProxyKey(routeKeyId)) ||
      isMaskedKeyRouteParam(routeKeyId)
    ) {
      return;
    }
    navigate(keyDetailPath(routeKeyId), { replace: true });
  }, [routeKeyId, navigate]);

  useEffect(() => {
    if (keyRecord?.description != null) {
      setNameDraft(keyRecord.description);
    }
  }, [keyRecord?.description]);

  const keyError = keyQuery.error;
  const stats = statsQuery.data;

  const masked = proxyKey ? maskKeyId(proxyKey) : (routeKeyId ?? "");
  const rateUsageFromStats = stats?.rate_usage ?? [];
  const rateUsageLegacy = rateLimitUsageForKey(rateQuery.data, proxyKey ?? "");
  const rateUsage =
    rateUsageFromStats.length > 0
      ? rateUsageFromStats.map((row) => ({
          window: row.window,
          requests: row.requests,
          tokens: row.tokens,
        }))
      : rateUsageLegacy;
  const rateOverride = rateLimitOverrideForKey(rateQuery.data, proxyKey ?? "");
  const rateSource = rateLimitUsageSource(
    stats?.rate_backend ?? rateQuery.data?.backend
  );

  const costToday = stats?.cost_today;
  const costMonth = stats?.cost_month;
  const piiToday = stats?.pii_today;
  const costSource = statsSource(costToday?.source ?? "memory");
  const monthSource = statsSource(costMonth?.source ?? "memory");
  const piiSource = statsSource(piiToday?.source ?? "memory");
  const costHistory = stats?.cost_history ?? [];
  const piiHistory = stats?.pii_history ?? [];
  const recentCost = stats?.recent_cost ?? [];
  const recentPii = stats?.recent_pii ?? [];

  const liveUpdatedAt = Math.max(
    statsQuery.dataUpdatedAt,
    rateQuery.dataUpdatedAt,
    keyQuery.dataUpdatedAt
  );
  const liveFetching =
    statsQuery.isFetching || rateQuery.isFetching || keyQuery.isFetching;

  const refreshAll = () => {
    keyQuery.refetch();
    statsQuery.refetch();
    rateQuery.refetch();
  };

  const requestsToday = costToday?.requests ?? 0;
  const statsLoaded = !statsQuery.isPending;

  const hasBeenUsed = Boolean(
    keyRecord?.first_request_at ||
      (statsLoaded &&
        (requestsToday > 0 ||
          (costMonth?.spend_usd ?? 0) > 0 ||
          recentCost.length > 0))
  );

  const setupMode = Boolean(
    isViewer && keyRecord && !hasBeenUsed && !setupDismissed
  );

  useEffect(() => {
    if (
      tabDefaultedRef.current ||
      keyQuery.isPending ||
      statsQuery.isPending ||
      !validRoute
    ) {
      return;
    }
    tabDefaultedRef.current = true;
    if (isViewer && !hasBeenUsed && !setupDismissed) {
      setTab("usage");
    }
  }, [
    hasBeenUsed,
    isViewer,
    keyQuery.isPending,
    setupDismissed,
    statsQuery.isPending,
    validRoute,
  ]);

  const dismissSetup = () => {
    if (!proxyKey) {
      return;
    }
    dismissKeySetup(proxyKey);
    setSetupDismissed(true);
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!(proxyKey && validRoute)) {
      return;
    }
    try {
      await updateKey.mutateAsync({
        key: validRoute,
        body: { description: nameDraft.trim() },
      });
      push("Name updated", "success");
      setEditingName(false);
    } catch (err) {
      push(
        err instanceof Error ? err.message : "Failed to update name",
        "error"
      );
    }
  };

  const sdkBaseUrl = keyRecord?.base_url;

  if (!routeKeyId) {
    return <ErrorAlert message="Missing key in URL." />;
  }

  if (!validRoute) {
    return (
      <div className="space-y-4">
        <Link
          className="link link-hover text-base-content/60 text-sm"
          to="/keys"
        >
          ← API Keys
        </Link>
        <ErrorAlert message="Invalid key link — open this page from a registered iw: proxy key." />
      </div>
    );
  }

  if (
    keyQuery.isPending ||
    statsQuery.isPending ||
    (!isViewer && rateQuery.isPending && !stats?.rate_usage?.length)
  ) {
    return <LoadingBlock />;
  }

  const title = keyRecord?.description?.trim() || "Unnamed key";
  const notFound = Boolean(keyError && !keyRecord);
  const isPersonal = keyRecord ? isPersonalKey(keyRecord) : false;
  const costLimitPeriod = keyRecord ? keyCostLimitPeriod(keyRecord) : "daily";
  const viewerMonthlyCents =
    me?.viewer_limits?.personal_monthly_cost_limit_cents ?? 0;
  const dailyLimitCents = keyRecord ? effectiveDailyLimitCents(keyRecord) : 0;
  const monthlyLimitCents = keyRecord
    ? effectiveMonthlyLimitCents(keyRecord, viewerMonthlyCents)
    : 0;
  const monthLabel = formatMonthYear(costMonth?.month);
  const rateRequestTotal = rateUsage.reduce((s, r) => s + r.requests, 0);
  const editorMaxCents = me?.editor_limits?.max_daily_cost_limit_cents ?? 0;
  const editorMaxDollars = editorMaxCents > 0 ? editorMaxCents / 100 : null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link className="link link-hover text-base-content/60" to="/keys">
          ← API Keys
        </Link>
      </div>

      <PageHeader
        actions={
          <LiveIndicator
            fetching={liveFetching}
            onRefresh={refreshAll}
            updatedAt={liveUpdatedAt}
          />
        }
        description={
          notFound
            ? "This key is not registered (it may have been deleted)."
            : isViewer
              ? "Your personal proxy key."
              : masked
        }
        title={
          editingName ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={saveName}
            >
              <input
                autoFocus
                className="input input-bordered input-sm w-full max-w-md"
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Key name"
                type="text"
                value={nameDraft}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={updateKey.isPending}
                type="submit"
              >
                Save
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(keyRecord?.description ?? "");
                }}
                type="button"
              >
                Cancel
              </button>
            </form>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{title}</span>
              {keyRecord && !notFound ? (
                <button
                  className="btn btn-ghost btn-xs text-base-content/60"
                  onClick={() => setEditingName(true)}
                  type="button"
                >
                  Rename
                </button>
              ) : null}
            </span>
          )
        }
      />

      {notFound ? (
        <div className="alert alert-warning">
          <span>
            Key metadata unavailable — open this page from a registered key to
            see stats.
          </span>
        </div>
      ) : null}

      {keyRecord && !notFound ? (
        <div className="glass-panel p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-medium text-base-content/70 text-sm">
              Key
            </span>
            <DataSourceBadge source="dynamodb" />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <ProviderBadge provider={keyRecord.provider} />
                <StatusBadge
                  active={keyRecord.enabled}
                  activeLabel="Enabled"
                  inactiveLabel="Disabled"
                />
                {isViewer ? null : (
                  <span className="badge badge-ghost badge-sm">
                    PII {piiLabel(keyRecord.redact_pii)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <MaskedKey value={keyRecord.key} />
                <CopyButton label="Copy key" value={keyRecord.key} />
              </div>
              <div className="text-base-content/60 text-sm">
                Dashboard ID: <MaskedCredentialId value={masked} />
              </div>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {isViewer || isPersonal ? (
                <Meta
                  label="Monthly limit"
                  value={formatMonthlyCostLimit(
                    monthlyLimitCents > 0
                      ? monthlyLimitCents
                      : keyRecord.monthly_cost_limit
                  )}
                />
              ) : (
                <>
                  <Meta
                    label={
                      costLimitPeriod === "monthly"
                        ? "Monthly limit"
                        : "Daily limit"
                    }
                    value={
                      costLimitPeriod === "monthly"
                        ? formatMonthlyCostLimit(monthlyLimitCents)
                        : formatDailyCostLimit(dailyLimitCents)
                    }
                  />
                  <Meta
                    label="Rate limits"
                    value={
                      [
                        keyRecord.rate_limit_rpm
                          ? `${keyRecord.rate_limit_rpm} rpm`
                          : null,
                        keyRecord.rate_limit_tpm
                          ? `${keyRecord.rate_limit_tpm.toLocaleString()} tpm`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }
                  />
                </>
              )}
              <Meta
                label="Created"
                value={new Date(keyRecord.created_at).toLocaleString()}
              />
            </div>
          </div>
        </div>
      ) : null}

      {keyRecord && !notFound ? (
        setupMode ? (
          <div className="glass-panel space-y-5 p-5 lg:p-6">
            <div className="space-y-2">
              <h2 className="font-semibold text-lg">Get set up</h2>
              <p className="text-base-content/70 text-sm">
                It looks like you haven&apos;t used this key yet. Point your SDK
                at the proxy with the snippets below — once we see your first
                request, usage and spend stats will show up here automatically.
              </p>
            </div>
            {sdkBaseUrl ? (
              <ProxyKeyUsagePanel
                baseUrl={sdkBaseUrl}
                embedded
                provider={keyRecord.provider}
                proxyKey={keyRecord.key}
              />
            ) : (
              <p className="text-base-content/60 text-sm">
                SDK base URL is unavailable — refresh the page or open this key
                from the API Keys list.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 border-base-300/60 border-t pt-4">
              <button
                className="btn btn-ghost btn-sm"
                onClick={dismissSetup}
                type="button"
              >
                Setup already?
              </button>
            </div>
          </div>
        ) : (
          <>
            <SpendOverview
              costSource={costSource}
              dailyLimitCents={dailyLimitCents}
              monthLabel={monthLabel}
              monthlyLimitCents={monthlyLimitCents}
              monthSource={monthSource}
              monthUsd={costMonth?.spend_usd ?? 0}
              showDailyLimit={
                costLimitPeriod === "daily" && dailyLimitCents > 0
              }
              showMonthlyLimit={
                costLimitPeriod === "monthly" && monthlyLimitCents > 0
              }
              todayUsd={costToday?.spend_usd ?? 0}
            />

            <div
              className={`grid gap-4 sm:grid-cols-2 ${isViewer ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
            >
              <LiveStat
                hint="cost tracker"
                source={costSource}
                title="Requests today"
                value={(costToday?.requests ?? 0).toLocaleString()}
              />
              <LiveStat
                hint={`${recentPii.length} recent events`}
                source={piiSource}
                title="PII detections"
                value={(piiToday?.detections ?? 0).toLocaleString()}
              />
              <LiveStat
                hint="today"
                source={costSource}
                title="Input tokens"
                value={(costToday?.input_tokens ?? 0).toLocaleString()}
              />
              {isViewer ? null : (
                <LiveStat
                  hint="requests in live windows"
                  source={rateSource}
                  title="Rate usage"
                  value={rateRequestTotal.toLocaleString()}
                />
              )}
            </div>

            <div className="glass-panel overflow-hidden">
              <div className="border-base-300/70 border-b bg-base-100/70 p-2">
                <div
                  aria-label="Key detail sections"
                  className="flex flex-wrap gap-2"
                  role="tablist"
                >
                  <button
                    aria-selected={tab === "usage"}
                    className={detailTabClass(tab === "usage")}
                    onClick={() => setTab("usage")}
                    role="tab"
                    type="button"
                  >
                    Usage
                  </button>
                  <button
                    aria-selected={tab === "cost"}
                    className={detailTabClass(tab === "cost")}
                    onClick={() => setTab("cost")}
                    role="tab"
                    type="button"
                  >
                    Cost
                    {recentCost.length > 0 ? (
                      <span className="badge badge-ghost badge-sm border-0">
                        {recentCost.length}
                      </span>
                    ) : null}
                  </button>
                  <button
                    aria-selected={tab === "pii"}
                    className={detailTabClass(tab === "pii")}
                    onClick={() => setTab("pii")}
                    role="tab"
                    type="button"
                  >
                    PII
                    {recentPii.length > 0 ? (
                      <span className="badge badge-ghost badge-sm border-0">
                        {recentPii.length}
                      </span>
                    ) : null}
                  </button>
                  {isViewer ? null : (
                    <button
                      aria-selected={tab === "rate-limits"}
                      className={detailTabClass(tab === "rate-limits")}
                      onClick={() => setTab("rate-limits")}
                      role="tab"
                      type="button"
                    >
                      Rate limits
                      {rateUsage.length > 0 ? (
                        <span className="badge badge-ghost badge-sm border-0">
                          {rateUsage.length}
                        </span>
                      ) : null}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4 lg:p-5">
                {tab === "usage" ? (
                  sdkBaseUrl ? (
                    <ProxyKeyUsagePanel
                      baseUrl={sdkBaseUrl}
                      embedded
                      provider={keyRecord.provider}
                      proxyKey={keyRecord.key}
                    />
                  ) : (
                    <p className="text-base-content/60 text-sm">
                      SDK base URL is unavailable — refresh the page or open
                      this key from the API Keys list.
                    </p>
                  )
                ) : null}

                {tab === "cost" ? (
                  <>
                    {stats?.rollup_available && costHistory.length > 0 ? (
                      <ChartCard
                        source="redis"
                        subtitle={`Last 7 days · ${DAILY_HISTORY_SUBTITLE}`}
                        title="Spend over time"
                      >
                        <BarChart
                          colors={costHistory.map(() => chartPalette.primary())}
                          label="Daily spend (USD)"
                          labels={chartLabels(costHistory)}
                          values={costHistory.map((p) => p.value)}
                        />
                      </ChartCard>
                    ) : null}

                    <DetailSection
                      source={costSource}
                      subtitle={
                        stats?.rollup_available
                          ? "Fleet rollups from Redis · recent events are memory-only (last 50)"
                          : "In-process tracked spend · recent events are memory-only (last 50)"
                      }
                      title="Cost breakdown"
                    >
                      {canManagePolicy && !isPersonal ? (
                        <KeyDetailPolicyEditor
                          editorMaxDollars={editorMaxDollars}
                          keyRecord={keyRecord}
                          routeKey={validRoute}
                          section="cost"
                        />
                      ) : null}
                      <div className="grid gap-4 p-5 lg:grid-cols-2">
                        <SpendPeriodPanel
                          limitCents={
                            costLimitPeriod === "daily" && dailyLimitCents > 0
                              ? dailyLimitCents
                              : undefined
                          }
                          limitLabel={
                            costLimitPeriod === "daily" && dailyLimitCents > 0
                              ? "Daily limit"
                              : undefined
                          }
                          source={costSource}
                          spentUsd={costToday?.spend_usd ?? 0}
                          subtitle="UTC calendar day"
                          title="Today"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Meta
                              label="Input spend"
                              value={formatUsd(costToday?.input_spend_usd ?? 0)}
                            />
                            <Meta
                              label="Output spend"
                              value={formatUsd(
                                costToday?.output_spend_usd ?? 0
                              )}
                            />
                            <Meta
                              label="Requests"
                              value={costToday?.requests ?? 0}
                            />
                            <Meta
                              label="Input tokens"
                              value={(
                                costToday?.input_tokens ?? 0
                              ).toLocaleString()}
                            />
                            <Meta
                              label="Output tokens"
                              value={(
                                costToday?.output_tokens ?? 0
                              ).toLocaleString()}
                            />
                          </div>
                        </SpendPeriodPanel>
                        <SpendPeriodPanel
                          limitCents={
                            costLimitPeriod === "monthly" &&
                            monthlyLimitCents > 0
                              ? monthlyLimitCents
                              : undefined
                          }
                          limitLabel={
                            costLimitPeriod === "monthly" &&
                            monthlyLimitCents > 0
                              ? "Monthly limit"
                              : undefined
                          }
                          source={monthSource}
                          spentUsd={costMonth?.spend_usd ?? 0}
                          subtitle={monthLabel}
                          title="This month"
                        >
                          <p className="text-base-content/60 text-sm">
                            Month-to-date total includes today. Prior days are
                            archived in Redis; today may include live in-process
                            spend before flush.
                          </p>
                        </SpendPeriodPanel>
                      </div>
                      <KeyCostEventsTable rows={recentCost} />
                    </DetailSection>
                  </>
                ) : null}

                {tab === "pii" ? (
                  <>
                    {stats?.rollup_available && piiHistory.length > 0 ? (
                      <ChartCard
                        source="redis"
                        subtitle={`Last 7 days · ${DAILY_HISTORY_SUBTITLE}`}
                        title="PII detections over time"
                      >
                        <BarChart
                          colors={piiHistory.map(() => chartPalette.warning())}
                          label="Daily detections"
                          labels={chartLabels(piiHistory)}
                          values={piiHistory.map((p) => p.value)}
                        />
                      </ChartCard>
                    ) : null}

                    <DetailSection
                      source={piiSource}
                      subtitle={
                        stats?.rollup_available
                          ? "Fleet-wide Redis count · recent events are memory-only (last 50)"
                          : "Recent events are memory-only (last 50)"
                      }
                      title="PII redaction"
                    >
                      {canManagePolicy && !isPersonal ? (
                        <KeyDetailPolicyEditor
                          editorMaxDollars={editorMaxDollars}
                          keyRecord={keyRecord}
                          routeKey={validRoute}
                          section="pii"
                        />
                      ) : null}
                      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                        <Meta
                          label="Detections today"
                          value={piiToday?.detections ?? 0}
                        />
                        <Meta label="Recent events" value={recentPii.length} />
                        {isViewer ? null : (
                          <>
                            <Meta
                              label="Global fail mode"
                              value={piiQuery.data?.fail_mode ?? "—"}
                            />
                            <Meta
                              label="Per-key override"
                              value={piiLabel(keyRecord.redact_pii)}
                            />
                          </>
                        )}
                      </div>
                      <KeyPiiEventsTable rows={recentPii} />
                    </DetailSection>
                  </>
                ) : null}

                {tab === "rate-limits" && !isViewer ? (
                  <DetailSection
                    source={rateSource}
                    subtitle="Overrides from key config (DynamoDB); usage from rate-limit backend"
                    title="Rate limits"
                  >
                    {canManagePolicy && !isPersonal ? (
                      <KeyDetailPolicyEditor
                        editorMaxDollars={editorMaxDollars}
                        keyRecord={keyRecord}
                        routeKey={validRoute}
                        section="rate-limits"
                      />
                    ) : null}
                    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                      <Meta
                        label="RPM override"
                        value={formatLimit(
                          rateOverride?.RequestsPerMinute ??
                            keyRecord.rate_limit_rpm
                        )}
                      />
                      <Meta
                        label="TPM override"
                        value={formatLimit(
                          rateOverride?.TokensPerMinute ??
                            keyRecord.rate_limit_tpm
                        )}
                      />
                      <Meta
                        label="RPD override"
                        value={formatLimit(
                          rateOverride?.RequestsPerDay ??
                            keyRecord.rate_limit_rpd
                        )}
                      />
                      <Meta
                        label="TPD override"
                        value={formatLimit(
                          rateOverride?.TokensPerDay ?? keyRecord.rate_limit_tpd
                        )}
                      />
                    </div>
                    <KeyRateUsageTable rows={rateUsage} />
                  </DetailSection>
                ) : null}
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-base-content/50 text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  source,
  children,
}: {
  title: string;
  subtitle?: string;
  source?: DataSource;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel overflow-hidden">
      <div className="border-base-300/70 border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          {source ? <DataSourceBadge source={source} /> : null}
        </div>
        {subtitle ? (
          <p className="mt-1 text-base-content/60 text-sm">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
