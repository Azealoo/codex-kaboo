import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { RangePicker } from "@/components/range-picker";
import { usePalette } from "@/providers/theme";

export default function TabsLayout() {
  const p = usePalette();
  const headerRight = () => (
    <View style={{ paddingRight: 12 }}>
      <RangePicker />
    </View>
  );
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: p.card },
        headerShadowVisible: false,
        headerTintColor: p.foreground,
        tabBarStyle: { backgroundColor: p.card, borderTopColor: p.border },
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.mutedForeground,
        sceneStyle: { backgroundColor: p.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Insights",
          headerRight,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "My Page",
          headerRight,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={String(color)} />
          ),
        }}
      />
    </Tabs>
  );
}
