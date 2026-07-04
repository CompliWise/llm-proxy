import type { ChartOptions } from "chart.js";
import { useMemo } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { liveTrendCaption } from "../../hooks/use-history";
import { useTheme } from "../../lib/theme";
import { type DataSource, DataSourceBadge } from "../ui/data-source";
import { chartPalette, ensureChartsRegistered } from "./chart-setup";

ensureChartsRegistered();

export interface TrendPoint {
  t: number;
  value: number;
}

const baseScales = () => {
  const tick = chartPalette.tick();
  return {
    x: {
      grid: { display: false },
      ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, color: tick },
    },
    y: {
      beginAtZero: true,
      grid: { color: chartPalette.grid() },
      ticks: { precision: 0, maxTicksLimit: 5, color: tick },
    },
  };
};

export function TrendChart({
  points,
  label,
  color,
  height = 220,
}: {
  points: TrendPoint[];
  label: string;
  color?: string;
  height?: number;
}) {
  const theme = useTheme();
  const stroke = color ?? chartPalette.primary();

  const data = useMemo(
    () => ({
      labels: points.map((p) =>
        new Date(p.t).toLocaleTimeString([], {
          minute: "2-digit",
          second: "2-digit",
        })
      ),
      datasets: [
        {
          label,
          data: points.map((p) => p.value),
          borderColor: stroke,
          backgroundColor: chartPalette.primarySoft(),
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    }),
    [points, label, stroke]
  );

  const options: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: baseScales(),
      interaction: { mode: "index", intersect: false },
    }),
    []
  );

  if (points.length === 0) {
    return <ChartEmpty height={height} label="Collecting data…" />;
  }

  return (
    <div className="space-y-2">
      <div style={{ height }}>
        <Line data={data} key={theme} options={options} />
      </div>
      <p className="text-base-content/50 text-xs">{liveTrendCaption(points)}</p>
    </div>
  );
}

export function BarChart({
  labels,
  values,
  label,
  colors,
  height = 220,
  horizontal = false,
}: {
  labels: string[];
  values: number[];
  label: string;
  colors?: string[];
  height?: number;
  horizontal?: boolean;
}) {
  const theme = useTheme();
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: colors ?? labels.map(() => chartPalette.primary()),
          borderRadius: 6,
          maxBarThickness: 48,
        },
      ],
    }),
    [labels, values, label, colors]
  );

  const options: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: { legend: { display: false } },
      scales: baseScales(),
    }),
    [horizontal]
  );

  if (labels.length === 0) {
    return <ChartEmpty height={height} label="No data" />;
  }

  return (
    <div style={{ height }}>
      <Bar data={data} key={theme} options={options} />
    </div>
  );
}

export function GroupedBarChart({
  labels,
  series,
  height = 220,
  horizontal = false,
  stacked = false,
}: {
  labels: string[];
  series: { label: string; values: number[]; color: string | (() => string) }[];
  height?: number;
  horizontal?: boolean;
  stacked?: boolean;
}) {
  const theme = useTheme();
  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values,
        backgroundColor: typeof s.color === "function" ? s.color() : s.color,
        borderRadius: 6,
        maxBarThickness: 48,
      })),
    }),
    [labels, series]
  );

  const options: ChartOptions<"bar"> = useMemo(() => {
    const scales = baseScales() as Record<string, Record<string, unknown>>;
    if (stacked) {
      scales.x = { ...scales.x, stacked: true };
      scales.y = { ...scales.y, stacked: true };
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            usePointStyle: true,
            padding: 12,
            color: chartPalette.tick(),
          },
        },
      },
      scales,
    };
  }, [horizontal, stacked]);

  if (labels.length === 0) {
    return <ChartEmpty height={height} label="No data" />;
  }

  return (
    <div style={{ height }}>
      <Bar data={data} key={theme} options={options} />
    </div>
  );
}

export function DonutChart({
  labels,
  values,
  colors,
  centerLabel,
  centerValue,
  height = 220,
}: {
  labels: string[];
  values: number[];
  colors: string[];
  centerLabel?: string;
  centerValue?: string;
  height?: number;
}) {
  const theme = useTheme();
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    }),
    [labels, values, colors]
  );

  const options: ChartOptions<"doughnut"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { display: false },
      },
    }),
    []
  );

  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <ChartEmpty height={height} label="No data" />;
  }

  return (
    <div className="flex flex-col">
      <div className="relative" style={{ height }}>
        <Doughnut data={data} key={theme} options={options} />
        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-semibold text-2xl leading-tight">
              {centerValue}
            </span>
            {centerLabel ? (
              <span className="text-base-content/50 text-xs uppercase tracking-wide">
                {centerLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
        {labels.map((label, i) => (
          <li
            className="flex items-center gap-1.5 text-base-content/70 text-xs"
            key={`${label}-${i}`}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartEmpty({ height, label }: { height: number; label: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-base-300/70 border-dashed text-base-content/50 text-sm"
      style={{ height }}
    >
      {label}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  source,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  source?: DataSource;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="glass-panel flex flex-col p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            {source ? <DataSourceBadge source={source} /> : null}
          </div>
          {subtitle ? (
            <p className="mt-1 text-base-content/60 text-sm">{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
