import { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { formatCompact } from "@shared/format";
import { niceCeiling, pickLabels, type Segment, type StackedData } from "@/lib/chart";
import { activityWeeks, relativeLevel, WEEKDAY_LABELS } from "@/lib/heatmap";
import { quotaColor } from "@/lib/theme";
import { usePalette } from "@/providers/theme";
import { Muted } from "./ui";

/** Measures its own width so charts can be laid out in pixels without a fixed size. */
function useWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(0);
  return [width, setWidth];
}

/** Stacked bars over time, one bar per bucket. Pure SVG; no animation so live updates stay calm. */
export function StackedBars({
  data,
  height = 180,
  format = formatCompact,
}: {
  data: StackedData;
  height?: number;
  format?: (v: number) => string;
}) {
  const p = usePalette();
  const [width, setWidth] = useWidth();
  const axisW = 40;
  const chartH = height - 20;
  const ceiling = niceCeiling(data.max);
  const n = data.bars.length;
  const plotW = Math.max(0, width - axisW);
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(2, Math.min(24, slot * 0.7));
  const labels = new Set(pickLabels(n, Math.max(2, Math.floor(plotW / 56))));
  const ticks = [0, 0.5, 1];
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%" }}>
      {width > 0 ? (
        <Svg width={width} height={height} accessibilityLabel="Stacked bar chart">
          {ticks.map((t) => (
            <G key={t}>
              <Line
                x1={axisW}
                x2={width}
                y1={chartH - t * chartH + 0.5}
                y2={chartH - t * chartH + 0.5}
                stroke={p.gridLine}
                strokeWidth={1}
              />
              <SvgText
                x={axisW - 6}
                y={chartH - t * chartH + 4}
                fontSize={10}
                fill={p.mutedForeground}
                textAnchor="end"
              >
                {format(t * ceiling)}
              </SvgText>
            </G>
          ))}
          {data.bars.map((bar, i) => {
            const x = axisW + i * slot + (slot - barW) / 2;
            let y = chartH;
            return (
              <G key={bar.x}>
                {bar.values.map((v, s) => {
                  const h = ceiling > 0 ? (v / ceiling) * chartH : 0;
                  y -= h;
                  return h > 0 ? (
                    <Rect
                      key={data.series[s]?.key ?? s}
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      fill={data.series[s]?.color ?? p.otherSeries}
                    />
                  ) : null;
                })}
                {labels.has(i) ? (
                  <SvgText
                    x={x + barW / 2}
                    y={height - 4}
                    fontSize={10}
                    fill={p.mutedForeground}
                    textAnchor="middle"
                  >
                    {bar.label}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

export function Legend({ series }: { series: { key: string; label: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {series.map((s) => (
        <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
          <Muted>{s.label}</Muted>
        </View>
      ))}
    </View>
  );
}

/** A 100 % horizontal bar with a legend row per segment (never a pie). */
export function ShareBar({
  segments,
  format = formatCompact,
}: {
  segments: Segment[];
  format?: (v: number) => string;
}) {
  const p = usePalette();
  const visible = segments.filter((s) => s.share > 0);
  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          height: 10,
          borderRadius: 3,
          overflow: "hidden",
          backgroundColor: p.muted,
          gap: 2,
        }}
      >
        {visible.map((s) => (
          <View
            key={s.key}
            style={{ flex: s.share, backgroundColor: s.color, borderRadius: 2, minWidth: 2 }}
          />
        ))}
      </View>
      <View style={{ gap: 4 }}>
        {segments.map((s) => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
            <Muted numberOfLines={1} style={{ flex: 1 }}>
              {s.label}
            </Muted>
            <Text
              style={{
                color: p.foreground,
                fontSize: 12,
                fontWeight: "500",
                fontVariant: ["tabular-nums"],
              }}
            >
              {format(s.value)}
            </Text>
            <Text
              style={{
                color: p.mutedForeground,
                fontSize: 12,
                width: 44,
                textAlign: "right",
                fontVariant: ["tabular-nums"],
              }}
            >
              {(s.share * 100).toFixed(1)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 180° arc meter for the shared weekly quota. */
export function QuotaArc({ usedPercent }: { usedPercent: number }) {
  const p = usePalette();
  const clamped = Math.max(0, Math.min(100, usedPercent));
  const color = quotaColor(p, usedPercent);
  // Arc from (15,100) to (185,100), radius 85: length = π·85 ≈ 267.
  const length = Math.PI * 85;
  return (
    <View
      style={{ alignItems: "center" }}
      accessibilityRole="image"
      accessibilityLabel={`Weekly quota used: ${Math.round(clamped)}%`}
    >
      <Svg width={200} height={110} viewBox="0 0 200 110">
        <Path
          d="M 15 100 A 85 85 0 0 1 185 100"
          fill="none"
          stroke={p.muted}
          strokeWidth={14}
          strokeLinecap="round"
        />
        <Path
          d="M 15 100 A 85 85 0 0 1 185 100"
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * length} ${length}`}
        />
      </Svg>
      <View style={{ marginTop: -44, alignItems: "center" }}>
        <Text style={{ color: p.foreground, fontSize: 28, fontWeight: "600" }}>
          {Math.round(clamped)}%
        </Text>
        <Muted>of weekly quota used</Muted>
      </View>
    </View>
  );
}

/** Thin line of quota readings; sharp drops (the weekly reset) get a hairline marker. */
export function Sparkline({
  points,
  from,
  to,
  height = 36,
}: {
  points: { t: number; usedPercent: number }[];
  from: number;
  to: number;
  height?: number;
}) {
  const p = usePalette();
  const [width, setWidth] = useWidth();
  const span = to - from;
  const xy = points
    .filter((pt) => pt.t >= from && pt.t <= to)
    .map((pt) => ({
      x: ((pt.t - from) / span) * width,
      y: height - (Math.min(100, Math.max(0, pt.usedPercent)) / 100) * height,
      used: pt.usedPercent,
    }));
  const d = xy
    .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");
  const last = xy[xy.length - 1];
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%" }}>
      {width > 0 && span > 0 ? (
        <Svg width={width} height={height}>
          {[0.6, 0.85].map((lvl) => (
            <Line
              key={lvl}
              x1={0}
              x2={width}
              y1={height - lvl * height}
              y2={height - lvl * height}
              stroke={p.gridLine}
              strokeDasharray="2 3"
            />
          ))}
          {xy.map((pt, i) =>
            i > 0 && xy[i - 1]!.used - pt.used >= 20 ? (
              <Line key={i} x1={pt.x} x2={pt.x} y1={0} y2={height} stroke={p.border} />
            ) : null,
          )}
          {xy.length >= 2 ? (
            <Path
              d={d}
              fill="none"
              stroke={p.foreground}
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ) : null}
          {last ? <Circle cx={last.x} cy={last.y} r={2.5} fill={quotaColor(p, last.used)} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** GitHub-style weeks × 7 heatmap, sized to the available width (most recent weeks visible). */
export function ActivityHeatmap({
  from,
  to,
  days,
}: {
  from: string;
  to: string;
  days: { day: string; tokens: number }[];
}) {
  const p = usePalette();
  const [width, setWidth] = useWidth();
  const weeks = activityWeeks(from, to, days);
  const gap = 2;
  const labelW = 26;
  const cell =
    width > 0
      ? Math.max(4, Math.floor((width - labelW - gap * (weeks.length - 1)) / weeks.length))
      : 0;
  const size = Math.min(cell, 12);
  // If the whole year does not fit, show the most recent weeks that do.
  const fit = width > 0 ? Math.max(1, Math.floor((width - labelW) / (size + gap))) : weeks.length;
  const shown = weeks.slice(Math.max(0, weeks.length - fit));
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%", gap: 6 }}>
      {width > 0 ? (
        <View style={{ flexDirection: "row", gap }}>
          <View style={{ width: labelW, gap }}>
            {WEEKDAY_LABELS.map((d, i) => (
              <Text
                key={d}
                style={{ height: size, fontSize: 9, lineHeight: size, color: p.mutedForeground }}
              >
                {i % 2 === 0 ? d : ""}
              </Text>
            ))}
          </View>
          {shown.map((week, w) => (
            <View key={w} style={{ gap }}>
              {week.map((c) => (
                <View
                  key={c.day}
                  accessibilityLabel={
                    c.inRange ? `${c.day}: ${formatCompact(c.tokens)} tokens` : undefined
                  }
                  style={{
                    width: size,
                    height: size,
                    borderRadius: 2,
                    backgroundColor: c.inRange ? p.heat[c.level] : "transparent",
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Muted>Less</Muted>
        {p.heat.map((c) => (
          <View key={c} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
        ))}
        <Muted>More · bins &lt;10M, &lt;100M, &lt;1B, ≥1B tokens</Muted>
      </View>
    </View>
  );
}

/** Weekday × hour grid coloured relative to the busiest cell. */
export function DayHourHeatmap({ grid }: { grid: number[][] }) {
  const p = usePalette();
  const [width, setWidth] = useWidth();
  const labelW = 26;
  const gap = 2;
  const cell = width > 0 ? Math.max(3, Math.floor((width - labelW - gap * 23) / 24)) : 0;
  const max = grid.reduce((m, row) => Math.max(m, ...row), 0);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%", gap }}>
      {width > 0
        ? WEEKDAY_LABELS.map((day, r) => (
            <View key={day} style={{ flexDirection: "row", gap, alignItems: "center" }}>
              <Text style={{ width: labelW, fontSize: 9, color: p.mutedForeground }}>{day}</Text>
              {Array.from({ length: 24 }, (_, h) => (
                <View
                  key={h}
                  accessibilityLabel={`${day} ${String(h).padStart(2, "0")}:00: ${formatCompact(grid[r]?.[h] ?? 0)} tokens`}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: 2,
                    backgroundColor: p.heat[relativeLevel(grid[r]?.[h] ?? 0, max)],
                  }}
                />
              ))}
            </View>
          ))
        : null}
      {width > 0 ? (
        <View style={{ flexDirection: "row", gap, marginLeft: labelW + gap }}>
          {Array.from({ length: 24 }, (_, h) => (
            <Text
              key={h}
              style={{ width: cell, fontSize: 8, color: p.mutedForeground, textAlign: "center" }}
            >
              {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
