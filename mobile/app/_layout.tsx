import { useAuth } from "@clerk/expo";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Button, Muted } from "@/components/ui";
import { CurrentUserProvider, useEnsureUser } from "@/providers/current-user";
import { AuthAndDataProvider } from "@/providers/convex";
import { RangeProvider } from "@/providers/range";
import { ThemeProvider, usePalette, useTheme } from "@/providers/theme";

function Centered({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.background,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}

/** Signed-in shell: waits for the Convex `users` row, then provides the id to every screen. */
function EnsuredUser({ children }: { children: ReactNode }) {
  const { ready, error, retry } = useEnsureUser();
  const p = usePalette();
  if (error !== null)
    return (
      <Centered>
        <Text style={{ color: p.foreground, fontWeight: "600" }}>Could not load your account</Text>
        <Muted style={{ textAlign: "center" }}>{error}</Muted>
        <Button title="Retry" variant="outline" onPress={retry} />
      </Centered>
    );
  if (ready === null)
    return (
      <Centered>
        <ActivityIndicator color={p.mutedForeground} />
      </Centered>
    );
  return (
    <CurrentUserProvider userId={ready}>
      <RangeProvider>{children}</RangeProvider>
    </CurrentUserProvider>
  );
}

function Routes() {
  const { isSignedIn } = useAuth();
  const { scheme, palette: p } = useTheme();
  const screenOptions = {
    headerStyle: { backgroundColor: p.card },
    headerTintColor: p.foreground,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: p.background },
  };
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={screenOptions}>
        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={isSignedIn === true}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="session/[id]" options={{ title: "Session", presentation: "modal" }} />
          <Stack.Screen name="user/[id]" options={{ title: "Teammate" }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/**
 * Convex queries must only mount once the Clerk token has reached Convex (`<Authenticated>`), or
 * they run unauthenticated and throw — the same gate the web's AppGate applies.
 */
function Gate() {
  const p = usePalette();
  return (
    <>
      <AuthLoading>
        <Centered>
          <ActivityIndicator color={p.mutedForeground} />
        </Centered>
      </AuthLoading>
      <Unauthenticated>
        <Routes />
      </Unauthenticated>
      <Authenticated>
        <EnsuredUser>
          <Routes />
        </EnsuredUser>
      </Authenticated>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthAndDataProvider>
          <Gate />
        </AuthAndDataProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
