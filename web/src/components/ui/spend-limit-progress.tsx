import { formatUsd } from "../../lib/format";

export function SpendLimitProgress({
  spentUsd,
  limitCents,
  label,
}: {
  spentUsd: number;
  limitCents: number | undefined | null;
  label: string;
}) {
  if (!limitCents || limitCents <= 0) {
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-2 text-base-content/60 text-xs">
          <span>{label}</span>
          <span>Unlimited</span>
        </div>
        <progress
          className="progress progress-neutral h-2 w-full opacity-25"
          max={100}
          value={0}
        />
      </div>
    );
  }

  const limitUsd = limitCents / 100;
  const ratio = limitUsd > 0 ? spentUsd / limitUsd : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const tone =
    ratio >= 0.95
      ? "progress-error"
      : ratio >= 0.8
        ? "progress-warning"
        : "progress-primary";

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-base-content/60 text-xs">
        <span>{label}</span>
        <span>
          {formatUsd(spentUsd)} / {formatUsd(limitUsd, 2)}
        </span>
      </div>
      <progress
        className={`progress h-2 w-full ${tone}`}
        max={100}
        value={pct}
      />
      <p className="text-base-content/50 text-xs">{pct.toFixed(1)}% of limit</p>
    </div>
  );
}
