"use client";

import { Area, Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { Stacked } from "@/lib/chart-data";
import { SeriesTooltip } from "./series-tooltip";

export type TrendVariant = "area" | "bars" | "both";
const TOTAL_KEY = "__t";

export function TrendChart({
  stacked,
  format,
  variant = "area",
  height = 260,
}: {
  stacked: Stacked;
  format: (value: number) => string;
  variant?: TrendVariant;
  height?: number;
}) {
  const config = Object.fromEntries(
    stacked.series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;
  const rows =
    variant === "both"
      ? stacked.rows.map((r) => ({
          ...r,
          [TOTAL_KEY]: stacked.series.reduce((acc, s) => acc + Number(r[s.key] ?? 0), 0),
        }))
      : stacked.rows;
  const last = stacked.series.length - 1;
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <ComposedChart
        data={rows}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} stroke="var(--grid-line)" strokeWidth={1} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          fontSize={11}
        />
        <YAxis
          width="auto"
          tickLine={false}
          axisLine={false}
          tickFormatter={format}
          fontSize={11}
        />
        {variant === "area"
          ? stacked.series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="a"
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.12}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            ))
          : stacked.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="a"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === last ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
        {variant === "both" ? (
          <Line
            type="monotone"
            dataKey={TOTAL_KEY}
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
            name="Total"
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: "var(--border)", fill: "var(--muted)", fillOpacity: 0.4 }}
          content={<SeriesTooltip series={stacked.series} format={format} />}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function StackedBarChart(props: {
  stacked: Stacked;
  format: (value: number) => string;
  height?: number;
}) {
  return <TrendChart {...props} variant="bars" />;
}
