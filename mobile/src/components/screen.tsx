import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACE } from "@/lib/theme";
import { usePalette } from "@/providers/theme";

/** Scrolling page body with the app background and safe-area bottom padding. */
export function Screen({
  children,
  refreshing = false,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{
        padding: SPACE.md,
        paddingBottom: insets.bottom + SPACE.xl,
        gap: SPACE.md,
      }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={p.mutedForeground}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>{children}</View>;
}

/** Half-width cell for `Grid2`. */
export function Half({ children }: { children: ReactNode }) {
  return <View style={{ width: "48.6%" }}>{children}</View>;
}
