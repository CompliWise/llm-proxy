import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ByoKeysPanel from "../../components/byo/byo-keys-panel";
import ApiKeysModal from "../../components/keys/api-keys-modal";
import KeyRequestsPanel from "../../components/keys/key-requests-panel";
import KeysTable from "../../components/keys/keys-table";
import RequestKeyModal from "../../components/keys/request-key-modal";
import { CopyButton } from "../../components/ui/copy-button";
import {
  DeployIcon,
  KeyRequestsTabIcon,
  KeyTabIcon,
  RequestKeyTabIcon,
  WarningTriangleIcon,
} from "../../components/ui/key-tab-icons";
import { maskKey } from "../../components/ui/masked-key";
import PageHeader, {
  EmptyState,
  ErrorAlert,
  LoadingBlock,
} from "../../components/ui/page-header";
import { useToast } from "../../components/ui/toast";
import {
  useBYOKeys,
  useConfig,
  useCost,
  useCreateKey,
  useCreateShare,
  useDeleteKey,
  useKeyRequests,
  useKeys,
  useMe,
  usePII,
  useProvisioning,
  useUpdateKey,
} from "../../hooks/queries";
import {
  costLimitsFromForm,
  defaultKeyForm,
  formatRateLimits,
  formPiiOffRequiresBedrock,
  KEY_PROVIDERS,
  type KeyFormState,
  keyFormFromRecord,
  piiFromFormValue,
  rateLimitsFromForm,
  VIEWER_PROVIDERS,
} from "../../lib/key-form";
import { permissions } from "../../lib/permissions";
import { formatShareExpiry } from "../../lib/share-expiry";
import type {
  APIKey,
  CreateAPIKeyRequest,
  Provider,
  ShareCreateResponse,
} from "../../types";

const PROVIDERS = KEY_PROVIDERS;

type KeysTab = "keys" | "requests" | "byo-keys";

function parseKeysTab(
  value: string | null,
  canReviewRequests: boolean,
  canManageByo: boolean
): KeysTab {
  if (value === "requests" && canReviewRequests) {
    return "requests";
  }
  if ((value === "byo-keys" || value === "byo-bans") && canManageByo) {
    return "byo-keys";
  }
  return "keys";
}

function keysTabClass(active: boolean): string {
  return active
    ? "btn btn-primary btn-sm gap-2 shadow-sm"
    : "btn btn-ghost btn-sm gap-2 text-base-content/70 hover:text-base-content";
}

function keyStatsDescription(
  hasCostRedis: boolean,
  hasPiiRedis: boolean
): string {
  if (hasCostRedis && hasPiiRedis) {
    return "Key registry is DynamoDB. Per-key spend and PII stats use Redis rollups (today updates live).";
  }
  if (hasCostRedis) {
    return "Key registry is DynamoDB. Per-key spend uses Redis rollups; PII stats are in-memory (today only).";
  }
  if (hasPiiRedis) {
    return "Key registry is DynamoDB. Per-key PII stats use Redis rollups; spend is in-memory (today only).";
  }
  return "Key registry is DynamoDB. Spend and PII stats on each key are in-memory (today only).";
}

export default function KeysPage() {
  const { push } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const { data: costData } = useCost();
  const { data: piiData } = usePII();
  const hasCostRedis = Boolean(costData?.stats?.daily_history_available);
  const hasPiiRedis = Boolean(piiData?.stats?.daily_history_available);
  const globalPiiEnabled = Boolean(config?.features?.pii_redact);
  const canBypassPiiBedrockPolicy = Boolean(
    me?.can_bypass_pii_off_non_bedrock_policy
  );
  const isViewer = permissions.isViewer(me?.role);
  const isAdmin = permissions.isAdmin(me?.role);
  const isEditor = permissions.isEditor(me?.role);
  const canManagePolicy = permissions.canManageKeyPolicy(me?.role);
  const canRequestServiceKey = permissions.canRequestServiceKey(me?.role);
  const canReviewKeyRequests = permissions.canReviewKeyRequests(me?.role);
  const canManageByo = permissions.canManageByo(me?.role);
  const canBulkGeneratePersonalKeys = permissions.canBulkGeneratePersonalKeys(
    me?.role
  );
  const canBulkGenerateOrgKeys = permissions.canBulkGenerateOrgKeys(me?.role);
  const bulkCreatesPersonalKeys = canBulkGeneratePersonalKeys;
  const tab = parseKeysTab(
    searchParams.get("tab"),
    canReviewKeyRequests,
    canManageByo
  );
  const { data: pendingRequests = [] } = useKeyRequests("pending");
  const { data: byoKeys = [] } = useBYOKeys();
  const bannedByoCount = byoKeys.filter((row) => row.banned).length;
  const pendingRequestCount = canReviewKeyRequests ? pendingRequests.length : 0;
  const [requestKeyModalOpen, setRequestKeyModalOpen] = useState(false);
  const handledRequestDeepLink = useRef(false);

  const setTab = (next: KeysTab) => {
    if (next === "keys") {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ tab: next }, { replace: true });
  };

  useEffect(() => {
    if (!canRequestServiceKey || handledRequestDeepLink.current) {
      return;
    }
    const openRequest =
      searchParams.get("request") === "1" ||
      searchParams.get("tab") === "request";
    if (!openRequest) {
      return;
    }
    handledRequestDeepLink.current = true;
    setRequestKeyModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("request");
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [canRequestServiceKey, searchParams, setSearchParams]);
  const provisionedKeysOnly = permissions.requiresProvisionedKeysOnly(me?.role);
  const canDeleteKeys = permissions.canDeleteKeys(me?.role);
  const viewerMonthlyCents =
    me?.viewer_limits?.personal_monthly_cost_limit_cents ?? 2000;
  const viewerMonthlyLimitLabel =
    viewerMonthlyCents > 0
      ? `$${(viewerMonthlyCents / 100).toFixed(2)}`
      : "Unlimited";
  const editorMaxCents = me?.editor_limits?.max_daily_cost_limit_cents ?? 0;
  const editorMaxDollars = editorMaxCents > 0 ? editorMaxCents / 100 : null;
  const bulkKeyDescription = me?.email?.split("@")[0]?.trim() ?? "";
  const [providerFilter, setProviderFilter] = useState<Provider | "">("");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null);
  const [editingKey, setEditingKey] = useState<APIKey | null>(null);
  const [form, setForm] = useState<KeyFormState>(defaultKeyForm);
  const [manualKeyEntry, setManualKeyEntry] = useState(false);
  const [personalMode, setPersonalMode] = useState(false);
  const [shareResult, setShareResult] = useState<ShareCreateResponse | null>(
    null
  );
  const [sharingKey, setSharingKey] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const filter = providerFilter || undefined;
  const { data: keys = [], isLoading, error } = useKeys(filter);
  const { data: provisioning } = useProvisioning();
  const createKey = useCreateKey();
  const updateKey = useUpdateKey();
  const deleteKey = useDeleteKey();
  const createShare = useCreateShare();

  const piiOffRequiresBedrock = formPiiOffRequiresBedrock(
    form.redact_pii,
    globalPiiEnabled,
    canBypassPiiBedrockPolicy
  );

  const anthropicProvisioning = provisioning?.providers?.anthropic;
  const anthropicTierOptions = anthropicProvisioning?.tiers ?? [];
  const anthropicDefaultTier = anthropicProvisioning?.default_tier ?? "metered";

  useEffect(() => {
    if (
      !modalOpen ||
      editingKey ||
      form.provider !== "anthropic" ||
      anthropicTierOptions.length === 0
    ) {
      return;
    }
    if (anthropicTierOptions.includes(form.anthropic_tier)) {
      return;
    }
    setForm((current) => ({
      ...current,
      anthropic_tier: anthropicDefaultTier,
    }));
  }, [
    modalOpen,
    editingKey,
    form.provider,
    form.anthropic_tier,
    anthropicTierOptions,
    anthropicDefaultTier,
  ]);

  useEffect(() => {
    if (
      !modalOpen ||
      editingKey ||
      !piiOffRequiresBedrock ||
      form.provider === "bedrock"
    ) {
      return;
    }
    setForm((current) => ({ ...current, provider: "bedrock" }));
  }, [modalOpen, editingKey, piiOffRequiresBedrock, form.provider]);

  const treatAsPersonal = isViewer || (personalMode && !editingKey);

  const myPersonalProviders = useMemo(() => {
    const set = new Set<Provider>();
    const email = me?.email?.toLowerCase();
    if (!email) {
      return set;
    }
    for (const k of keys) {
      if (
        k.tags?.personal === "true" &&
        k.owner_email?.toLowerCase() === email
      ) {
        set.add(k.provider);
      }
    }
    return set;
  }, [keys, me?.email]);

  const availableProviders = useMemo(() => {
    let providers: Provider[];
    if (isViewer) {
      const owned = new Set(keys.map((k) => k.provider));
      providers = VIEWER_PROVIDERS.filter(
        (p) => !owned.has(p) || p === editingKey?.provider
      );
    } else if (personalMode) {
      providers = VIEWER_PROVIDERS.filter((p) => !myPersonalProviders.has(p));
    } else if (piiOffRequiresBedrock) {
      providers = ["bedrock"];
    } else {
      providers = [...PROVIDERS];
    }
    if ((isViewer || personalMode) && provisioning?.enabled) {
      return providers.filter(
        (p) => provisioning.providers?.[p]?.auto_provision
      );
    }
    if (!(provisionedKeysOnly && provisioning?.enabled)) {
      return providers;
    }
    return providers.filter((p) => provisioning.providers?.[p]?.auto_provision);
  }, [
    isViewer,
    personalMode,
    keys,
    editingKey?.provider,
    myPersonalProviders,
    piiOffRequiresBedrock,
    provisionedKeysOnly,
    provisioning,
  ]);

  const canCreateKey = availableProviders.length > 0;

  const missingProvidersForBulk = useMemo(() => {
    if (!provisionedKeysOnly) {
      return [];
    }
    const owned = new Set(keys.map((k) => k.provider));
    return availableProviders.filter((provider) => !owned.has(provider));
  }, [provisionedKeysOnly, keys, availableProviders]);

  const missingPersonalProvidersForBulk = useMemo(() => {
    if (!provisioning?.enabled) {
      return [];
    }
    return VIEWER_PROVIDERS.filter(
      (provider) =>
        provisioning.providers?.[provider]?.auto_provision &&
        !myPersonalProviders.has(provider)
    );
  }, [provisioning, myPersonalProviders]);

  const bulkTargetProviders = isViewer
    ? missingProvidersForBulk
    : isAdmin
      ? missingPersonalProvidersForBulk
      : missingProvidersForBulk;

  const showBulkGenerate =
    bulkTargetProviders.length > 0 &&
    (canBulkGeneratePersonalKeys || canBulkGenerateOrgKeys);
  const bulkGenerateLabel = bulkCreatesPersonalKeys
    ? "Generate Personal Keys"
    : "Generate Missing Keys";

  const providerAutoProvision = Boolean(
    provisioning?.enabled &&
      provisioning.providers?.[form.provider]?.auto_provision
  );
  const useAutoProvision =
    treatAsPersonal || provisionedKeysOnly
      ? providerAutoProvision
      : providerAutoProvision && !manualKeyEntry;
  const showAnthropicTierSelect =
    form.provider === "anthropic" &&
    useAutoProvision &&
    anthropicTierOptions.length > 0;

  const onShare = async (record: APIKey) => {
    setSharingKey(record.key);
    try {
      const result = await createShare.mutateAsync(record.key);
      setShareResult(result);
    } catch (err) {
      push(
        err instanceof Error ? err.message : "Failed to create share link",
        "error"
      );
    } finally {
      setSharingKey(null);
    }
  };

  const openCreate = () => {
    setEditingKey(null);
    const nextProvider = provisionedKeysOnly
      ? (availableProviders[0] ?? defaultKeyForm.provider)
      : isViewer
        ? (availableProviders[0] ?? "openai")
        : defaultKeyForm.provider;
    setForm({ ...defaultKeyForm, provider: nextProvider });
    setManualKeyEntry(false);
    setPersonalMode(false);
    setModalOpen(true);
  };

  const onTogglePersonalMode = (on: boolean) => {
    setPersonalMode(on);
    setManualKeyEntry(false);
    setForm((current) => ({
      ...current,
      provider: on
        ? (VIEWER_PROVIDERS.find((p) => !myPersonalProviders.has(p)) ??
          current.provider)
        : defaultKeyForm.provider,
    }));
  };

  const openEdit = (record: APIKey) => {
    setEditingKey(record);
    setPersonalMode(false);
    setForm(keyFormFromRecord(record, anthropicDefaultTier));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingKey(null);
    setForm(defaultKeyForm);
    setManualKeyEntry(false);
    setPersonalMode(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const {
      daily_cost_limit: dailyCostLimit,
      monthly_cost_limit: monthlyCostLimit,
    } = costLimitsFromForm(form);
    const activeCostLimit =
      form.cost_limit_period === "monthly" ? monthlyCostLimit : dailyCostLimit;
    if (editorMaxCents > 0 && activeCostLimit > editorMaxCents) {
      push(
        `${form.cost_limit_period === "monthly" ? "Monthly" : "Daily"} cost limit cannot exceed $${editorMaxDollars}`,
        "error"
      );
      return;
    }
    const redactPii = piiFromFormValue(form.redact_pii);

    try {
      if (editingKey) {
        if (canManagePolicy) {
          await updateKey.mutateAsync({
            key: editingKey.key,
            body: {
              description: form.description,
              daily_cost_limit: dailyCostLimit,
              monthly_cost_limit: monthlyCostLimit,
              enabled: form.enabled,
              redact_pii: redactPii,
              ...rateLimitsFromForm(form),
            },
          });
          push("Key updated", "success");
        } else {
          await updateKey.mutateAsync({
            key: editingKey.key,
            body: { description: form.description },
          });
          push("Key updated", "success");
        }
      } else if (treatAsPersonal) {
        if (!useAutoProvision) {
          push(
            "Automatic key provisioning is not available for this provider",
            "error"
          );
          return;
        }
        const body: CreateAPIKeyRequest = {
          provider: form.provider,
          description: form.description,
          auto_provision: true,
        };
        if (!isViewer) {
          body.personal = true;
        }
        await createKey.mutateAsync(body);
        push("Personal key created", "success");
      } else {
        if (!useAutoProvision) {
          if (provisionedKeysOnly) {
            push(
              "Automatic key provisioning is not available for this provider",
              "error"
            );
            return;
          }
          if (!form.actual_key.trim()) {
            push("Provider API key is required", "error");
            return;
          }
        }
        const body: CreateAPIKeyRequest = {
          provider: form.provider,
          description: form.description,
          daily_cost_limit: dailyCostLimit,
          monthly_cost_limit: monthlyCostLimit,
          enabled: form.enabled,
          redact_pii: redactPii,
          ...rateLimitsFromForm(form),
        };
        if (useAutoProvision) {
          body.auto_provision = true;
          if (form.provider === "anthropic" && form.anthropic_tier) {
            body.tags = { tier: form.anthropic_tier };
          }
        } else {
          body.actual_key = form.actual_key;
        }
        await createKey.mutateAsync(body);
        push("Key created", "success");
      }
      closeModal();
    } catch (err) {
      push(err instanceof Error ? err.message : "Request failed", "error");
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await deleteKey.mutateAsync(deleteTarget.key);
      push("Key deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      push(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const onBulkGeneratePersonalKeys = async () => {
    if (bulkTargetProviders.length === 0) {
      return;
    }
    setBulkGenerating(true);
    let created = 0;
    let failed = 0;
    try {
      for (const provider of bulkTargetProviders) {
        try {
          if (bulkCreatesPersonalKeys) {
            await createKey.mutateAsync({
              provider,
              description: bulkKeyDescription,
              auto_provision: true,
              ...(isAdmin ? { personal: true } : {}),
            });
          } else if (isEditor) {
            const {
              daily_cost_limit: dailyCostLimit,
              monthly_cost_limit: monthlyCostLimit,
            } = costLimitsFromForm(defaultKeyForm);
            const activeCostLimit =
              defaultKeyForm.cost_limit_period === "monthly"
                ? monthlyCostLimit
                : dailyCostLimit;
            if (editorMaxCents > 0 && activeCostLimit > editorMaxCents) {
              push(
                `${defaultKeyForm.cost_limit_period === "monthly" ? "Monthly" : "Daily"} cost limit cannot exceed $${editorMaxDollars}`,
                "error"
              );
              return;
            }
            const body: CreateAPIKeyRequest = {
              provider,
              description: "",
              daily_cost_limit: dailyCostLimit,
              monthly_cost_limit: monthlyCostLimit,
              enabled: defaultKeyForm.enabled,
              redact_pii: piiFromFormValue(defaultKeyForm.redact_pii),
              auto_provision: true,
              ...rateLimitsFromForm(defaultKeyForm),
            };
            if (provider === "anthropic" && anthropicDefaultTier) {
              body.tags = { tier: anthropicDefaultTier };
            }
            await createKey.mutateAsync(body);
          }
          created += 1;
        } catch {
          failed += 1;
        }
      }
      if (created > 0) {
        push(
          bulkCreatesPersonalKeys
            ? `Created ${created} personal key${created === 1 ? "" : "s"}`
            : `Created ${created} key${created === 1 ? "" : "s"}`,
          "success"
        );
      }
      if (failed > 0) {
        push(
          `Failed to create ${failed} key${failed === 1 ? "" : "s"}`,
          "error"
        );
      }
    } finally {
      setBulkGenerating(false);
    }
  };

  const saving = createKey.isPending || updateKey.isPending;
  const bulkGenerateBusy = bulkGenerating || createKey.isPending;

  const visibleKeys = useMemo(() => keys, [keys]);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          tab === "keys" ? (
            <>
              {isViewer ? null : (
                <select
                  className="select select-bordered select-sm"
                  onChange={(event) =>
                    setProviderFilter(event.target.value as Provider | "")
                  }
                  value={providerFilter}
                >
                  <option value="">All providers</option>
                  {PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              )}
              {isViewer ? null : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canCreateKey}
                  onClick={openCreate}
                  type="button"
                >
                  Create key
                </button>
              )}
              {canRequestServiceKey ? (
                <button
                  className={`btn btn-sm gap-2 ${isViewer ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setRequestKeyModalOpen(true)}
                  type="button"
                >
                  <RequestKeyTabIcon />
                  Request a key
                </button>
              ) : null}
            </>
          ) : null
        }
        description={
          isViewer
            ? viewerMonthlyCents > 0
              ? `Personal proxy keys (one per provider). Monthly spend is capped at ${viewerMonthlyLimitLabel}.`
              : "Personal proxy keys (one per provider). Monthly spend is unlimited."
            : keyStatsDescription(hasCostRedis, hasPiiRedis)
        }
        title={isViewer ? "My API Keys" : "API Keys"}
      />

      {canReviewKeyRequests || canManageByo ? (
        <div className="glass-panel p-2">
          <div
            aria-label="API keys sections"
            className="flex flex-wrap gap-2"
            role="tablist"
          >
            <button
              aria-selected={tab === "keys"}
              className={keysTabClass(tab === "keys")}
              onClick={() => setTab("keys")}
              role="tab"
              type="button"
            >
              <KeyTabIcon />
              Keys
            </button>
            <button
              aria-selected={tab === "byo-keys"}
              className={keysTabClass(tab === "byo-keys")}
              onClick={() => setTab("byo-keys")}
              role="tab"
              type="button"
            >
              BYO keys
              {byoKeys.length > 0 ? (
                <span className="badge badge-ghost badge-sm border-0">
                  {byoKeys.length}
                </span>
              ) : null}
              {bannedByoCount > 0 ? (
                <span className="badge badge-error badge-sm border-0">
                  {bannedByoCount} banned
                </span>
              ) : null}
            </button>
            <button
              aria-selected={tab === "requests"}
              className={keysTabClass(tab === "requests")}
              onClick={() => setTab("requests")}
              role="tab"
              type="button"
            >
              <KeyRequestsTabIcon />
              Key requests
              {pendingRequestCount > 0 ? (
                <span className="badge badge-warning badge-sm border-0">
                  {pendingRequestCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "keys" &&
      (canRequestServiceKey || canBulkGeneratePersonalKeys) ? (
        canRequestServiceKey ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-warning/50 bg-warning/15 px-4 py-3 shadow-sm lg:flex-nowrap">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning text-warning-content">
              <WarningTriangleIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-base-content/80 text-sm leading-snug">
              <span className="font-semibold text-warning-content">
                Personal keys are for local testing only.
              </span>{" "}
              <span className="font-semibold text-error">
                Do not deploy with them.
              </span>{" "}
              Request an org-wide key with a specific use case; admins will name
              and provision it.
            </div>
            <button
              className="btn btn-warning btn-sm shrink-0 gap-2 shadow-sm"
              onClick={() => setRequestKeyModalOpen(true)}
              type="button"
            >
              <DeployIcon />
              Request a key
            </button>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-info/40 bg-info/10 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full bg-info/20 text-info">
              <KeyTabIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-base-content/80 text-sm leading-snug">
              Use <span className="font-medium">Generate Personal Keys</span>{" "}
              below or toggle <span className="font-medium">Personal key</span>{" "}
              in Create key for your own testing keys (one per provider, capped
              at {viewerMonthlyLimitLabel}/month). Org-wide service keys stay
              separate. Review pending requests on the{" "}
              <button
                className="link link-info inline-flex items-center gap-1 align-middle font-medium"
                onClick={() => setTab("requests")}
                type="button"
              >
                <KeyRequestsTabIcon className="h-4 w-4" />
                Key requests
              </button>{" "}
              tab.
            </div>
          </div>
        )
      ) : null}

      {tab === "requests" && canReviewKeyRequests ? <KeyRequestsPanel /> : null}
      {tab === "byo-keys" && canManageByo ? <ByoKeysPanel /> : null}

      <RequestKeyModal
        onClose={() => setRequestKeyModalOpen(false)}
        open={requestKeyModalOpen}
      />

      {tab === "keys" ? (
        <>
          {error ? (
            <ErrorAlert
              message={
                error instanceof Error ? error.message : "Failed to load keys"
              }
            />
          ) : null}

          {showBulkGenerate && visibleKeys.length > 0 ? (
            <div className="glass-panel flex flex-col items-center gap-3 px-6 py-8 text-center sm:items-start sm:text-left">
              <button
                className="btn btn-primary btn-lg min-h-16 w-full px-8 text-lg sm:w-auto"
                disabled={bulkGenerateBusy}
                onClick={onBulkGeneratePersonalKeys}
                type="button"
              >
                {bulkGenerateBusy ? (
                  <span className="loading loading-spinner loading-md" />
                ) : null}
                {bulkGenerateLabel}
              </button>
              <p className="max-w-2xl text-base-content/60 text-sm">
                {bulkCreatesPersonalKeys
                  ? `Creates one auto-provisioned personal key for each provider you do not have yet (${bulkTargetProviders.join(", ")}).`
                  : `Creates one auto-provisioned org key for each provider without a key yet (${bulkTargetProviders.join(", ")}).`}
              </p>
            </div>
          ) : null}

          <div className="glass-panel overflow-hidden">
            {isLoading ? (
              <LoadingBlock />
            ) : visibleKeys.length === 0 ? (
              <EmptyState
                action={
                  showBulkGenerate ? (
                    <button
                      className="btn btn-primary btn-lg min-h-16 w-full max-w-md px-8 text-lg"
                      disabled={bulkGenerateBusy}
                      onClick={onBulkGeneratePersonalKeys}
                      type="button"
                    >
                      {bulkGenerateBusy ? (
                        <span className="loading loading-spinner loading-md" />
                      ) : null}
                      {bulkGenerateLabel}
                    </button>
                  ) : !isViewer && canCreateKey ? (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={openCreate}
                      type="button"
                    >
                      Create your first key
                    </button>
                  ) : undefined
                }
                message={
                  isViewer
                    ? "No personal keys yet. Generate one proxy key per provider to route LLM requests."
                    : "No API keys yet. Create a proxy key to route provider requests through iw: keys."
                }
              />
            ) : (
              <KeysTable
                canDelete={canDeleteKeys}
                formatRateLimits={formatRateLimits}
                keys={visibleKeys}
                maskKey={maskKey}
                onDelete={setDeleteTarget}
                onEdit={openEdit}
                onShare={onShare}
                sharingKey={sharingKey}
                viewerMode={isViewer}
              />
            )}
          </div>

          <ApiKeysModal
            anthropicTierOptions={anthropicTierOptions}
            availableProviders={availableProviders}
            canManagePolicy={canManagePolicy}
            editingKey={editingKey}
            editorMaxDollars={editorMaxDollars}
            form={form}
            isViewer={isViewer}
            manualKeyEntry={manualKeyEntry}
            onClose={closeModal}
            onSubmit={onSubmit}
            onTogglePersonalMode={onTogglePersonalMode}
            open={modalOpen}
            personalMode={personalMode}
            piiOffRequiresBedrock={piiOffRequiresBedrock}
            providerAutoProvision={providerAutoProvision}
            provisionedKeysOnly={provisionedKeysOnly}
            saving={saving}
            setForm={setForm}
            setManualKeyEntry={setManualKeyEntry}
            showAnthropicTierSelect={showAnthropicTierSelect}
            treatAsPersonal={treatAsPersonal}
            useAutoProvision={useAutoProvision}
            viewerMonthlyLimitLabel={viewerMonthlyLimitLabel}
          />

          {shareResult ? (
            <dialog className="modal modal-open" open>
              <div className="modal-box max-w-lg">
                <h3 className="font-semibold text-lg">
                  Shareable link created
                </h3>
                <p className="py-3 text-base-content/70 text-sm">
                  Send this link to whoever needs the key. Anyone with the link
                  can view it until it expires. The URL contains no key
                  material.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-base-200/70 px-3 py-2 font-mono text-sm">
                    {shareResult.url}
                  </code>
                  <CopyButton label="Copy link" value={shareResult.url} />
                </div>
                {shareResult.expires_at ? (
                  <p
                    className={`mt-3 text-sm ${
                      formatShareExpiry(shareResult.expires_at).urgent
                        ? "text-warning"
                        : "text-base-content/60"
                    }`}
                  >
                    {formatShareExpiry(shareResult.expires_at).message}.
                    Re-sharing the same key within 24 hours reuses this URL.
                  </p>
                ) : null}
                <div className="modal-action">
                  <a
                    className="btn btn-ghost"
                    href={shareResult.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShareResult(null)}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
              <form className="modal-backdrop" method="dialog">
                <button
                  aria-label="Close"
                  onClick={() => setShareResult(null)}
                  type="button"
                />
              </form>
            </dialog>
          ) : null}

          {deleteTarget ? (
            <dialog className="modal modal-open" open>
              <div className="modal-box">
                <h3 className="font-semibold text-lg">Delete API key?</h3>
                <p className="py-4 text-base-content/70 text-sm">
                  This will permanently remove{" "}
                  <span className="code-chip font-mono">
                    {deleteTarget ? maskKey(deleteTarget.key) : ""}
                  </span>
                  .
                </p>
                <div className="modal-action">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setDeleteTarget(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-error"
                    disabled={deleteKey.isPending}
                    onClick={onDelete}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <form className="modal-backdrop" method="dialog">
                <button
                  aria-label="Close"
                  onClick={() => setDeleteTarget(null)}
                  type="button"
                />
              </form>
            </dialog>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
