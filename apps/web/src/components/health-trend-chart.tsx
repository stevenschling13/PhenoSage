"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";

export interface HealthTrendPoint {
  /** ISO timestamp the analysis was produced at. */
  analyzedAt: string;
  /** 0–100, clamped on render. */
  score: number;
}

interface Props {
  points: HealthTrendPoint[];
  className?: string;
}

const CHART_W = 640;
const CHART_H = 180;
const PAD_X = 36;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function clamp(score: number): number {
  if (Number.isNaN(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

function scoreColor(score: number): string {
  if (score >= 75) return "rgb(var(--ps-ok))";
  if (score >= 50) return "rgb(var(--ps-warn))";
  return "rgb(var(--ps-crit))";
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * Tier-1 longitudinal intelligence: a small SVG line chart of health
 * scores over time. Pure SVG so we don't add a chart dependency.
 *
 * Empty / single-point inputs render a friendly "needs more data"
 * state — the caller is responsible for not rendering this at all
 * if there are zero analyses.
 */
export function HealthTrendChart({ points, className }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const sorted = useMemo(
    () =>
      [...points]
        .map((p) => ({ ...p, score: clamp(p.score) }))
        .sort(
          (a, b) =>
            new Date(a.analyzedAt).getTime() - new Date(b.analyzedAt).getTime(),
        ),
    [points],
  );

  if (sorted.length < 2) {
    return (
      <div
        className={cn(
          "rounded-[14px] border border-dashed border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] p-5 text-[13px] text-[rgb(var(--ps-muted))]",
          className,
        )}
        role="img"
        aria-label="Health score trend (insufficient data)"
      >
        Trend chart wakes up after the second analysis. Keep capturing the same
        plant from the same angle to make the chart meaningful.
      </div>
    );
  }

  const innerW = CHART_W - PAD_X * 2;
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const tStart = new Date(sorted[0]!.analyzedAt).getTime();
  const tEnd = new Date(sorted[sorted.length - 1]!.analyzedAt).getTime();
  const tSpan = Math.max(1, tEnd - tStart);

  const coords = sorted.map((p, i) => {
    const t = new Date(p.analyzedAt).getTime();
    // Even spacing fallback when all timestamps collapse to the same value.
    const x =
      tSpan === 1
        ? PAD_X + (innerW * i) / Math.max(1, sorted.length - 1)
        : PAD_X + ((t - tStart) / tSpan) * innerW;
    const y = PAD_TOP + innerH * (1 - p.score / 100);
    return { x, y, score: p.score, analyzedAt: p.analyzedAt };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M ${coords[0]!.x.toFixed(1)} ${(PAD_TOP + innerH).toFixed(1)} ` +
    coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ") +
    ` L ${coords[coords.length - 1]!.x.toFixed(1)} ${(PAD_TOP + innerH).toFixed(1)} Z`;

  const lastScore = sorted[sorted.length - 1]!.score;
  const firstScore = sorted[0]!.score;
  const delta = Math.round(lastScore - firstScore);
  const trendLabel =
    delta > 2
      ? `Up ${delta} from first analysis`
      : delta < -2
        ? `Down ${Math.abs(delta)} from first analysis`
        : "Roughly flat across analyses";

  // y-axis grid lines at 0/50/100
  const grid = [0, 50, 100].map((v) => ({
    v,
    y: PAD_TOP + innerH * (1 - v / 100),
  }));

  const hovered = hover != null ? coords[hover] : null;

  return (
    <figure
      aria-label="Plant health score trend"
      className={cn(
        "rounded-[14px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] p-4",
        className,
      )}
    >
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="ps-mono text-[10.5px] uppercase tracking-[0.12em] text-[rgb(var(--ps-muted))]">
          Health score over time
        </span>
        <span className="text-[12px] text-[rgb(var(--ps-ink-2))]">
          {trendLabel}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Health score trend with ${sorted.length} data points`}
        className="w-full h-auto"
      >
        <defs>
          <linearGradient id="ps-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={scoreColor(lastScore)}
              stopOpacity="0.28"
            />
            <stop
              offset="100%"
              stopColor={scoreColor(lastScore)}
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <g key={g.v}>
            <line
              x1={PAD_X}
              x2={CHART_W - PAD_X}
              y1={g.y}
              y2={g.y}
              stroke="rgb(var(--ps-line))"
              strokeOpacity="0.5"
              strokeDasharray={g.v === 0 || g.v === 100 ? undefined : "2 4"}
            />
            <text
              x={PAD_X - 6}
              y={g.y + 3}
              textAnchor="end"
              fontSize="10"
              fill="rgb(var(--ps-muted))"
            >
              {g.v}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#ps-trend-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke={scoreColor(lastScore)}
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c, i) => (
          <g key={`${c.analyzedAt}-${i}`}>
            <circle
              cx={c.x}
              cy={c.y}
              r={hover === i ? 4.5 : 3}
              fill={scoreColor(c.score)}
              stroke="rgb(var(--ps-surface))"
              strokeWidth="1.5"
            />
            <rect
              x={c.x - 12}
              y={PAD_TOP}
              width="24"
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              tabIndex={0}
              role="button"
              aria-label={`Score ${Math.round(c.score)} on ${fmtDate(c.analyzedAt)}`}
            />
          </g>
        ))}
        {/* x-axis labels: first, middle (if >2), last */}
        {coords.length > 0 ? (
          <text
            x={coords[0]!.x}
            y={CHART_H - 8}
            textAnchor="start"
            fontSize="10"
            fill="rgb(var(--ps-muted))"
          >
            {fmtDate(coords[0]!.analyzedAt)}
          </text>
        ) : null}
        {coords.length > 0 ? (
          <text
            x={coords[coords.length - 1]!.x}
            y={CHART_H - 8}
            textAnchor="end"
            fontSize="10"
            fill="rgb(var(--ps-muted))"
          >
            {fmtDate(coords[coords.length - 1]!.analyzedAt)}
          </text>
        ) : null}
        {hovered ? (
          <g pointerEvents="none">
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
              stroke="rgb(var(--ps-ink))"
              strokeOpacity="0.25"
              strokeDasharray="2 3"
            />
            <text
              x={hovered.x}
              y={PAD_TOP - 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="rgb(var(--ps-ink))"
            >
              {Math.round(hovered.score)} · {fmtDate(hovered.analyzedAt)}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
