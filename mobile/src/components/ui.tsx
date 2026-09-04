import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { formatDeltaPercent } from "@shared/format";
import {
  deltaTone,
  formatMetricValue,
  type GoodDirection,
  type MetricKind,
} from "@shared/metric-defs";
import { usePalette } from "@/providers/theme";
import { RADIUS, SPACE } from "@/lib/theme";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: p.card,
          borderColor: p.border,
          borderWidth: 1,
          borderRadius: RADIUS,
          padding: SPACE.lg,
          gap: SPACE.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return (
    <Text style={[{ color: p.foreground, fontSize: 15, fontWeight: "600" }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const p = usePalette();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: p.foreground, fontSize: 14 }, style]}>
      {children}
    </Text>
  );
}

export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const p = usePalette();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: p.mutedForeground, fontSize: 12 }, style]}>
      {children}
    </Text>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return (
    <Text style={[{ color: p.foreground, fontVariant: ["tabular-nums"], fontSize: 13 }, style]}>
      {children}
    </Text>
  );
}

export function Skeleton({
  height = 24,
  style,
}: {
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <View
      accessibilityLabel="Loading"
      style={[{ height, borderRadius: 8, backgroundColor: p.muted }, style]}
    />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        alignItems: "center",
        padding: SPACE.xl,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: p.border,
        borderRadius: RADIUS,
        gap: 4,
      }}
    >
      <Body style={{ fontWeight: "500" }}>{title}</Body>
      {description ? <Muted style={{ textAlign: "center" }}>{description}</Muted> : null}
    </View>
  );
}

export function Badge({
  children,
  tone = "outline",
}: {
  children: ReactNode;
  tone?: "outline" | "good" | "warning" | "muted";
}) {
  const p = usePalette();
  const styles = {
    outline: { borderColor: p.border, backgroundColor: "transparent", color: p.foreground },
    good: { borderColor: "transparent", backgroundColor: p.deltaUpBg, color: p.deltaUpFg },
    warning: {
      borderColor: "transparent",
      backgroundColor: `${p.statusWarning}33`,
      color: p.foreground,
    },
    muted: { borderColor: "transparent", backgroundColor: p.muted, color: p.mutedForeground },
  }[tone];
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: styles.borderColor,
        backgroundColor: styles.backgroundColor,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: styles.color, fontSize: 10, fontWeight: "500" }}>{children}</Text>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const p = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        backgroundColor: p.muted,
        borderRadius: 10,
        padding: 2,
        alignSelf: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: on ? p.card : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: on ? p.foreground : p.mutedForeground,
                fontWeight: on ? "600" : "400",
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DeltaPill({
  change,
  goodDirection,
}: {
  change: number | null;
  goodDirection: GoodDirection;
}) {
  const p = usePalette();
  if (change === null) return null;
  const { tone, good } = deltaTone(change, goodDirection);
  const bg = good === true ? p.deltaUpBg : good === false ? p.deltaDownBg : p.deltaFlatBg;
  const fg = good === true ? p.deltaUpFg : good === false ? p.deltaDownFg : p.deltaFlatFg;
  const icon = tone === "up" ? "arrow-up" : tone === "down" ? "arrow-down" : "remove";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        backgroundColor: bg,
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Ionicons name={icon} size={10} color={fg} />
      <Text style={{ color: fg, fontSize: 11, fontWeight: "500", fontVariant: ["tabular-nums"] }}>
        {formatDeltaPercent(change)}
      </Text>
    </View>
  );
}

export function StatCard({
  label,
  value,
  kind = "count",
  change = null,
  goodDirection = "up",
  footer,
  badge,
  style,
}: {
  label: string;
  value: number | null | string;
  kind?: MetricKind;
  change?: number | null;
  goodDirection?: GoodDirection;
  footer?: string;
  badge?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const text = typeof value === "string" ? value : formatMetricValue(kind, value);
  return (
    <Card style={[{ gap: 4, padding: SPACE.md }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <Muted numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </Muted>
        {badge ? <Badge>{badge}</Badge> : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 4,
        }}
      >
        <Text
          style={{
            color: p.foreground,
            fontSize: 20,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {text}
        </Text>
        <DeltaPill change={change} goodDirection={goodDirection} />
      </View>
      {footer ? <Muted numberOfLines={2}>{footer}</Muted> : null}
    </Card>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }, style]}>
      {children}
    </View>
  );
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const p = usePalette();
  const bg =
    variant === "primary"
      ? p.primary
      : variant === "destructive"
        ? `${p.destructive}1a`
        : "transparent";
  const fg =
    variant === "primary"
      ? p.primaryForeground
      : variant === "destructive"
        ? p.destructive
        : p.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: bg,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: p.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 14, fontWeight: "500" }}>{title}</Text>
    </Pressable>
  );
}

/** A key/value list row used by breakdown tables and the session detail. */
export function KeyValue({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
      {color ? (
        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      ) : null}
      <Body numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </Body>
      <View style={{ alignItems: "flex-end" }}>
        <Mono style={{ fontWeight: "600" }}>{value}</Mono>
        {sub ? (
          <Text style={{ color: p.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
