export type Provider = "openai" | "anthropic" | "gemini" | "bedrock";

export type PiiRedactSetting = boolean | null;

export type AdminRole = "admin" | "editor" | "viewer";

export interface EditorLimits {
  max_daily_cost_limit_cents: number;
}

export interface ViewerLimits {
  personal_monthly_cost_limit_cents: number;
}

export interface AdminUser {
  can_bypass_pii_off_non_bedrock_policy?: boolean;
  editor_limits?: EditorLimits;
  email: string;
  name?: string;
  picture?: string;
  role?: AdminRole;
  viewer_limits?: ViewerLimits;
}

export interface AdminUserRecord {
  created_at: string;
  email: string;
  last_login_at?: string;
  name?: string;
  picture?: string;
  role: AdminRole;
  updated_at: string;
}

export interface CreateAdminUserRequest {
  email: string;
  role: AdminRole;
}

export interface UpdateAdminUserRoleRequest {
  role: AdminRole;
}

export type KeyRequestStatus = "pending" | "approved" | "rejected";

export interface KeyRequestRecord {
  created_at: string;
  created_key?: string;
  daily_cost_limit?: number;
  description: string;
  id: string;
  provider: Provider;
  rejection_reason?: string;
  requester_email: string;
  reviewed_at?: string;
  reviewed_by?: string;
  status: KeyRequestStatus;
  updated_at: string;
}

export interface CreateKeyRequestBody {
  daily_cost_limit?: number;
  description: string;
  provider: Provider;
}

export interface ReviewKeyRequestBody {
  action: "approve" | "reject";
  rejection_reason?: string;
}

export interface APIKey {
  base_url?: string;
  created_at: string;
  daily_cost_limit: number;
  description?: string;
  enabled: boolean;
  expires_at?: string | null;
  first_request_at?: string | null;
  key: string;
  masked_key_id?: string;
  monthly_cost_limit?: number;
  owner_email?: string;
  provider: Provider;
  provisioned?: boolean;
  proxy_base?: string;
  rate_limit_rpd?: number;
  rate_limit_rpm?: number;
  rate_limit_tpd?: number;
  rate_limit_tpm?: number;
  redact_pii?: PiiRedactSetting;
  tags?: Record<string, string>;
  updated_at: string;
}

export interface ProvisioningProviderStatus {
  auto_provision: boolean;
  default_tier?: string;
  pool_available?: number;
  tiers?: string[];
}

export type AnthropicTier = "metered" | "elevated" | "unrestricted";

export interface ProvisioningStatus {
  enabled: boolean;
  providers?: Partial<Record<Provider, ProvisioningProviderStatus>>;
}

export interface CreateAPIKeyRequest {
  actual_key?: string;
  auto_provision?: boolean;
  daily_cost_limit?: number;
  description?: string;
  enabled?: boolean;
  monthly_cost_limit?: number;
  personal?: boolean;
  provider: Provider;
  rate_limit_rpd?: number;
  rate_limit_rpm?: number;
  rate_limit_tpd?: number;
  rate_limit_tpm?: number;
  redact_pii?: PiiRedactSetting;
  tags?: Record<string, string>;
}

export interface UpdateAPIKeyRequest {
  daily_cost_limit?: number;
  description?: string;
  enabled?: boolean;
  monthly_cost_limit?: number;
  rate_limit_rpd?: number;
  rate_limit_rpm?: number;
  rate_limit_tpd?: number;
  rate_limit_tpm?: number;
  redact_pii?: PiiRedactSetting;
  tags?: Record<string, string>;
}

export interface FeatureToggle {
  analyzer_url?: string;
  backend?: string;
  enabled: boolean;
  fail_mode?: string;
  mode?: string;
  region?: string;
  table_name?: string;
}

export interface ConfigSummary {
  environment?: string;
  features: {
    cost_tracking?: FeatureToggle;
    api_key_management?: FeatureToggle;
    rate_limiting?: FeatureToggle;
    circuit_breaker?: FeatureToggle;
    pii_redact?: FeatureToggle;
    admin_dashboard?: FeatureToggle;
  };
}

export interface DailyHistoryRow {
  day: string;
  [key: string]:
    | string
    | number
    | boolean
    | undefined
    | Record<string, unknown>;
}

export interface HourlyHistoryRow {
  hour: number;
  [key: string]: number | undefined;
}

export interface StatsWithDailyHistory {
  daily_history?: DailyHistoryRow[];
  daily_history_available?: boolean;
  hourly_history?: HourlyHistoryRow[];
  hourly_history_available?: boolean;
}

export interface CircuitBreakerProviderHealth {
  cooldown_until?: number;
  error?: string;
  failures?: number;
  rollup?: {
    enabled: boolean;
    open: boolean;
    count: number;
    threshold: number;
    window_seconds: number;
    open_keys?: string[];
  };
  state?: string;
}

export interface HealthResponse {
  circuit_breaker?: {
    enabled: boolean;
    mode: string;
    backend: string;
    redis_fallback?: boolean;
    providers?: Record<string, CircuitBreakerProviderHealth>;
    degraded_signal?: string;
    total_failures?: number;
    daily_history?: DailyHistoryRow[];
    daily_history_available?: boolean;
    hourly_history?: HourlyHistoryRow[];
    hourly_history_available?: boolean;
  };
  features?: {
    cost_tracking?: boolean;
    circuit_breaker?: boolean;
  };
  providers?: Record<string, unknown>;
  status: string;
  timestamp: number;
}

export interface CircuitActivityEvent {
  failure_kind?: string;
  key?: string;
  kind: string;
  new_state?: string;
  provider: string;
  reason?: string;
  status_code?: number;
  time: number;
  upstream_error?: string;
}

export interface CircuitActivityResponse {
  available?: boolean;
  backend?: string;
  blocked_open?: number;
  by_key?: Record<string, number>;
  by_provider?: Record<string, number>;
  checks_total?: number;
  circuits_opened?: number;
  daily_history?: DailyHistoryRow[];
  daily_history_available?: boolean;
  day?: string;
  probes_failed?: number;
  probes_started?: number;
  probes_succeeded?: number;
  recent_events?: CircuitActivityEvent[];
  started_at?: number;
}

export interface RateLimitConfig {
  RequestsPerDay?: number;
  RequestsPerMinute?: number;
  TokensPerDay?: number;
  TokensPerMinute?: number;
}

export interface RateLimitCounter {
  requests?: number;
  tokens?: number;
}

export interface RateLimitWindow {
  counters?: Record<string, RateLimitCounter>;
  window_start?: string;
}

export interface RateLimitOverrides {
  PerKey?: Record<string, RateLimitConfig> | null;
  PerModel?: Record<string, RateLimitConfig> | null;
  PerUser?: Record<string, RateLimitConfig> | null;
}

export interface RateLimitSnapshot {
  day?: RateLimitWindow;
  minute?: RateLimitWindow;
}

export interface RateLimitsResponse {
  backend?: string;
  enabled: boolean;
  limits?: RateLimitConfig;
  overrides?: RateLimitOverrides;
  snapshot?: RateLimitSnapshot;
}

export interface CostTransport {
  host?: string;
  namespace?: string;
  path?: string;
  port?: string;
  region?: string;
  table_name?: string;
  type: string;
}

export interface CostKeySpend {
  input_spend_usd?: number;
  input_tokens: number;
  key_id?: string;
  output_spend_usd?: number;
  output_tokens: number;
  requests: number;
  spend_usd: number;
}

export interface CostScopeSpend {
  input_spend_usd?: number;
  input_tokens: number;
  output_spend_usd?: number;
  output_tokens: number;
  requests: number;
  spend_usd: number;
}

export interface CostProviderSpend {
  input_spend_usd?: number;
  input_tokens: number;
  name: string;
  output_spend_usd?: number;
  output_tokens: number;
  requests: number;
  spend_usd: number;
}

export interface CostRecentEvent {
  input_spend_usd?: number;
  input_tokens: number;
  key_id?: string;
  model?: string;
  output_spend_usd?: number;
  output_tokens: number;
  provider: string;
  spend_usd: number;
  time: number;
  user_id?: string;
}

export interface CostStats extends StatsWithDailyHistory {
  available: boolean;
  by_key?: CostKeySpend[];
  by_provider?: CostProviderSpend[];
  by_user?: Record<string, CostScopeSpend>;
  day?: string;
  input_spend_today_usd?: number;
  input_tokens_today?: number;
  output_spend_today_usd?: number;
  output_tokens_today?: number;
  recent?: CostRecentEvent[];
  requests_today?: number;
  spend_today_usd?: number;
  started_at?: number;
}

export interface CostResponse {
  async?: boolean;
  enabled: boolean;
  flush_interval?: number;
  queue_size?: number;
  stats?: CostStats;
  transport_count?: number;
  transports?: CostTransport[];
  workers?: number;
}

export interface PIINameCount {
  count: number;
  name: string;
}

export interface PIIRecentEvent {
  body_bytes: number;
  duration_ms: number;
  entity_counts?: Record<string, number> | null;
  entity_total: number;
  key_id?: string;
  outcome: "ok" | "fail_open" | "fail_closed" | "oversize";
  pipeline?: string;
  provider: string;
  time: number;
}

export interface IDGateRecentEvent {
  duration_ms: number;
  entity_type?: string;
  image_count?: number;
  image_index?: number;
  key_id?: string;
  outcome: "clear" | "blocked" | "fail_open" | "fail_closed";
  pipeline: string;
  provider: string;
  score?: number;
  stage?: string;
  time: number;
}

export interface IDGateStats extends StatsWithDailyHistory {
  available: boolean;
  by_entity?: PIINameCount[];
  by_provider?: PIINameCount[];
  day?: string;
  fail_closed?: number;
  fail_open?: number;
  images_scanned?: number;
  recent?: IDGateRecentEvent[];
  recent_backend?: string;
  requests_blocked?: number;
  requests_cleared?: number;
  requests_with_images?: number;
  started_at?: number;
  top_keys?: PIINameCount[];
}

export interface PIIStats extends StatsWithDailyHistory {
  available: boolean;
  by_entity?: PIINameCount[];
  by_provider?: PIINameCount[];
  detection_rate?: number;
  entities_total?: number;
  fail_closed?: number;
  fail_open?: number;
  oversize?: number;
  recent?: PIIRecentEvent[];
  recent_backend?: string;
  requests_scanned?: number;
  requests_with_pii?: number;
  started_at?: number;
  top_keys?: PIINameCount[];
}

export interface PIIResponse {
  allow_per_key_override: boolean;
  enabled: boolean;
  fail_mode: string;
  id_gate_enabled: boolean;
  id_gate_fail_mode: string;
  id_gate_stats: IDGateStats;
  stats: PIIStats;
  wire_placeholders: boolean;
}

export interface ModelStatusNameCount {
  count: number;
  name: string;
}

export interface ModelStatusRegistryEntry {
  aliases?: string[];
  model: string;
  provider: string;
  replacement?: string;
  retired_date?: string;
}

export interface ModelStatusRegistry {
  deprecated: ModelStatusRegistryEntry[];
  retired: ModelStatusRegistryEntry[];
}

export interface ModelStatusStats extends StatsWithDailyHistory {
  available: boolean;
  backend?: string;
  by_deprecated?: ModelStatusNameCount[];
  by_retired?: ModelStatusNameCount[];
  by_unknown?: ModelStatusNameCount[];
  day?: string;
  deprecated_total?: number;
  retired_total?: number;
  started_at?: number;
  unknown_total?: number;
}

export interface ModelStatusResponse {
  registry: ModelStatusRegistry;
  stats: ModelStatusStats;
}

export interface UsageScopeCounter {
  requests?: number;
  tokens?: number;
}

export interface UsageStats extends StatsWithDailyHistory {
  available: boolean;
  counters?: Record<string, UsageScopeCounter>;
  day?: string;
  requests_today?: number;
  started_at?: number;
  tokens_today?: number;
  top_models?: PIINameCount[];
  top_providers?: PIINameCount[];
}

export interface UsageResponse {
  enabled: boolean;
  source?: string;
  stats?: UsageStats;
}

export interface ShareCreateResponse {
  created_at: string;
  expires_at?: string;
  id: string;
  provider: Provider;
  url: string;
}

export interface ShareInfo {
  base_url: string;
  created_at: string;
  created_by?: string;
  description?: string;
  enabled: boolean;
  expires_at?: string;
  id: string;
  key: string;
  provider: Provider;
  proxy_base: string;
}

export interface APIError {
  error: string;
}

export type KeyStatsSource = "memory" | "redis" | "redislive";

export interface KeyCostStats {
  input_spend_usd: number;
  input_tokens: number;
  output_spend_usd: number;
  output_tokens: number;
  requests: number;
  source: KeyStatsSource;
  spend_usd: number;
}

export interface KeyCostMonthStats {
  month: string;
  source: KeyStatsSource;
  spend_usd: number;
}

export interface KeyRateUsageStats {
  requests: number;
  tokens: number;
  window: "day" | "minute";
}

export interface KeyPIIStats {
  detections: number;
  source: KeyStatsSource;
}

export interface KeyDayPoint {
  day: string;
  value: number;
}

export interface KeyCostRecentEvent {
  input_spend_usd?: number;
  input_tokens: number;
  key_id?: string;
  model?: string;
  output_spend_usd?: number;
  output_tokens: number;
  provider: string;
  spend_usd: number;
  time: number;
}

export interface KeyPIIRecentEvent {
  duration_ms: number;
  entity_counts: Record<string, number>;
  entity_total: number;
  key_id?: string;
  outcome: "ok" | "fail_open" | "fail_closed" | "oversize";
  provider: string;
  time: number;
}

export interface KeyStatsResponse {
  cost_history: KeyDayPoint[];
  cost_month: KeyCostMonthStats;
  cost_today: KeyCostStats;
  day: string;
  masked_key_id: string;
  pii_history: KeyDayPoint[];
  pii_today: KeyPIIStats;
  rate_backend?: string;
  rate_usage?: KeyRateUsageStats[];
  recent_cost: KeyCostRecentEvent[];
  recent_pii: KeyPIIRecentEvent[];
  rollup_available: boolean;
  rollup_backend?: string;
}

export interface BYOBanRecord {
  banned_by?: string;
  created_at: string;
  hash: string;
  masked_id: string;
  provider: Provider;
  reason?: string;
}

export interface BYOKeyRecord {
  banned: boolean;
  banned_at?: string;
  banned_by?: string;
  cost_requests: number;
  hash: string;
  masked_id: string;
  pii_scans: number;
  provider: Provider;
  reason?: string;
  sources: string[];
  spend_usd: number;
}

export interface CreateBYOBanRequest {
  masked_id: string;
  provider: Provider;
  reason?: string;
}
