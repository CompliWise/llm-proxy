import { formatUsd } from "../../lib/format";
import { type DataSource, DataSourceBadge } from "./data-source";
import { SpendLimitProgress } from "./spend-limit-progress";

/** Hero spend summary: today + month with limit progress bars. */
export function SpendOverview({
  todayUsd,
  monthUsd,
  monthLabel,
  dailyLimitCents,
  monthlyLimitCents,
  costSource,
  monthSource,
  showDailyLimit,
  showMonthlyLimit = true,
}: {
  todayUsd: number;
  monthUsd: number;
  monthLabel: string;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  costSource: DataSource;
  monthSource: DataSource;
  /** Show daily limit progress when the key uses a daily cap. */
  showDailyLimit: boolean;
  /** Show monthly limit progress when the key uses a monthly cap. */
  showMonthlyLimit?: boolean;
}) {
  return (
    <div className="glass-panel p-5">
      <div className="mb-4">
        <h3 className="font-semibold">Spend</h3>
        <p className="text-base-content/60 text-sm">
          UTC day and calendar month · fleet rollups where available
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SpendOverviewColumn
          hint="UTC calendar day"
          label="Today"
          limitCents={showDailyLimit ? dailyLimitCents : 0}
          limitLabel={showDailyLimit ? "Daily limit" : undefined}
          source={costSource}
          spentUsd={todayUsd}
        />
        <SpendOverviewColumn
          hint={monthLabel}
          label="This month"
          limitCents={showMonthlyLimit ? monthlyLimitCents : 0}
          limitLabel={showMonthlyLimit ? "Monthly limit" : undefined}
          source={monthSource}
          spentUsd={monthUsd}
        />
      </div>
    </div>
  );
}

function SpendOverviewColumn({
  label,
  hint,
  spentUsd,
  limitCents,
  limitLabel,
  source,
}: {
  label: string;
  hint: string;
  spentUsd: number;
  limitCents: number;
  limitLabel?: string;
  source: DataSource;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-base-content/80 text-sm">{label}</p>
          <p className="text-base-content/50 text-xs">{hint}</p>
        </div>
        <DataSourceBadge source={source} />
      </div>
      <p className="font-semibold text-3xl tracking-tight">
        {formatUsd(spentUsd)}
      </p>
      {limitLabel ? (
        <SpendLimitProgress
          label={limitLabel}
          limitCents={limitCents}
          spentUsd={spentUsd}
        />
      ) : null}
    </div>
  );
}

export function SpendPeriodPanel({
  title,
  subtitle,
  source,
  spentUsd,
  limitCents,
  limitLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  source: DataSource;
  spentUsd: number;
  limitCents?: number;
  limitLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-base-300/70 bg-base-100/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-medium">{title}</h4>
          {subtitle ? (
            <p className="text-base-content/60 text-sm">{subtitle}</p>
          ) : null}
        </div>
        <DataSourceBadge source={source} />
      </div>
      <div className="mb-3">
        <p className="text-base-content/50 text-xs uppercase tracking-wide">
          Total spend
        </p>
        <p className="font-semibold text-xl">{formatUsd(spentUsd)}</p>
      </div>
      {limitLabel ? (
        <div className="mb-3">
          <SpendLimitProgress
            label={limitLabel}
            limitCents={limitCents ?? 0}
            spentUsd={spentUsd}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
