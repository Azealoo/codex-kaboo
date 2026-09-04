import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Muted } from "@/components/ui";
import { configProblems } from "@/providers/convex";
import { usePalette } from "@/providers/theme";

/**
 * Sign-in hands off to Clerk's hosted Account Portal for this Clerk instance — the same accounts,
 * sign-in methods (email, Google, …) and restrictions as the web dashboard, with nothing to
 * duplicate here. The session comes back to the app through the `codex-kaboo://` scheme.
 */
export default function SignIn() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = configProblems();

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startHostedAuth({ mode: "sign-in" });
      if (
        result.createdSessionId === null &&
        result.authSessionResult?.type !== "cancel" &&
        result.authSessionResult?.type !== "dismiss"
      ) {
        setError("Sign-in did not complete. Try again.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.background,
        justifyContent: "center",
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
    >
      <View style={{ alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: "#0f1115",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#008300",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#8fe08f" }} />
          </View>
        </View>
        <Text style={{ color: p.foreground, fontSize: 24, fontWeight: "700" }}>codex-kaboo</Text>
        <Muted style={{ textAlign: "center", fontSize: 14 }}>
          Codex usage for your shared account: tokens, cost, cache hits and the weekly quota, on
          your phone.
        </Muted>
      </View>
      <Card style={{ gap: 12 }}>
        {problems.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: p.destructive, fontWeight: "600" }}>
              This build is not configured
            </Text>
            {problems.map((m) => (
              <Muted key={m}>{m}</Muted>
            ))}
            <Muted>Set both in mobile/.env (see .env.example) and rebuild.</Muted>
          </View>
        ) : null}
        <Button
          title={busy ? "Opening sign-in…" : "Sign in"}
          icon="log-in-outline"
          onPress={() => void signIn()}
          disabled={busy || problems.length > 0}
        />
        {error ? <Text style={{ color: p.destructive, fontSize: 12 }}>{error}</Text> : null}
        <Muted style={{ textAlign: "center" }}>
          Uses the same account as the web dashboard. Anyone who can sign in sees the whole team.
        </Muted>
      </Card>
    </View>
  );
}
