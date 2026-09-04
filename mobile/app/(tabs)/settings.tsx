import { useAuth, useUser } from "@clerk/expo";
import * as Clipboard from "expo-clipboard";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { api } from "@convex/_generated/api";
import type { SyncTokenRow } from "@convex/lib/types";
import { formatDateTime, formatRelative, formatUsd } from "@shared/format";
import { Avatar } from "@/components/avatar";
import { Screen } from "@/components/screen";
import { SectionCard } from "@/components/section-card";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  Muted,
  SegmentedControl,
  Skeleton,
} from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { useCurrentUserId } from "@/providers/current-user";
import { useTheme, type ThemePreference } from "@/providers/theme";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function TokenRow({ t }: { t: SyncTokenRow }) {
  const now = useNow();
  const revoke = useMutation(api.syncTokens.revoke);
  const confirm = () =>
    Alert.alert(
      `Revoke “${t.name}” (${t.prefix}…)?`,
      "Machines using it stop syncing immediately. Already uploaded data is kept. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () =>
            void revoke({ tokenId: t._id }).catch((e: unknown) =>
              Alert.alert("Could not revoke", String(e)),
            ),
        },
      ],
    );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
      <View style={{ flex: 1 }}>
        <Muted style={{ fontSize: 14, fontWeight: "500" }}>
          {t.name} <Text style={{ fontWeight: "400" }}>({t.prefix}…)</Text>
        </Muted>
        <Muted>
          created {formatDateTime(t.createdAt)} ·{" "}
          {t.lastUsedAt === null ? "never used" : `used ${formatRelative(t.lastUsedAt, now)}`}
        </Muted>
      </View>
      {t.revokedAt === null ? (
        <>
          <Badge tone="good">Active</Badge>
          <Button title="Revoke" variant="destructive" onPress={confirm} />
        </>
      ) : (
        <Badge>Revoked</Badge>
      )}
    </View>
  );
}

function SyncTokens() {
  const tokens = useQuery(api.syncTokens.list, {});
  const create = useAction(api.syncTokens.create);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const { palette: p } = useTheme();
  const onCreate = async () => {
    setCreating(true);
    try {
      const label = name.trim() || "My machine";
      const r = await create({ name: label });
      setCreated({ token: r.token, name: label });
      setName("");
    } catch (e: unknown) {
      Alert.alert("Could not create the token", e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };
  return (
    <SectionCard
      title="Sync tokens"
      description="The collector authenticates with a token. Only its hash is stored; the raw value is shown once."
    >
      {created ? (
        <Card style={{ backgroundColor: p.accent, borderColor: p.accent }}>
          <Muted style={{ color: p.accentForeground, fontWeight: "600" }}>
            Token “{created.name}” created — copy it now, it is shown only once.
          </Muted>
          <Text selectable style={{ color: p.foreground, fontFamily: "Menlo", fontSize: 12 }}>
            {created.token}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              title="Copy login command"
              icon="copy-outline"
              onPress={() =>
                void Clipboard.setStringAsync(`codex-kaboo login --token ${created.token}`).then(
                  () =>
                    Alert.alert(
                      "Copied",
                      "Paste it in a terminal on the machine where Codex runs.",
                    ),
                )
              }
            />
            <Button title="Done" variant="outline" onPress={() => setCreated(null)} />
          </View>
        </Card>
      ) : (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Token name (e.g. MacBook)"
            placeholderTextColor={p.mutedForeground}
            accessibilityLabel="Token name"
            maxLength={64}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: p.border,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
              color: p.foreground,
            }}
          />
          <Button
            title={creating ? "Creating…" : "New token"}
            onPress={() => void onCreate()}
            disabled={creating}
          />
        </View>
      )}
      {tokens === undefined ? (
        <Skeleton height={60} />
      ) : tokens.length === 0 ? (
        <EmptyState
          title="No tokens yet"
          description="Create one, then run the install commands on your machine."
        />
      ) : (
        <View>
          {tokens.map((t) => (
            <TokenRow key={t._id} t={t} />
          ))}
        </View>
      )}
    </SectionCard>
  );
}

function Prices() {
  const prices = useQuery(api.prices.list, {});
  return (
    <SectionCard
      title="Model prices"
      description="USD per million tokens (input / cached / output). Edit them on the web dashboard."
    >
      {prices === undefined ? (
        <Skeleton height={80} />
      ) : prices.length === 0 ? (
        <EmptyState title="No prices yet" />
      ) : (
        <View>
          {prices.map((pr) => (
            <KeyValue
              key={pr._id}
              label={pr.model}
              value={`${formatUsd(pr.inputUsdPerMTok)} / ${formatUsd(pr.cachedInputUsdPerMTok)} / ${formatUsd(pr.outputUsdPerMTok)}`}
            />
          ))}
        </View>
      )}
    </SectionCard>
  );
}

function Machines() {
  const me = useCurrentUserId();
  const machines = useQuery(api.machines.list, {});
  const users = useQuery(api.users.list, {});
  const now = useNow();
  const names = new Map((users ?? []).map((u) => [u.userId as string, u.name]));
  return (
    <SectionCard
      title="Machines"
      description="Every machine that has synced. Rename your own on the web dashboard."
    >
      {machines === undefined ? (
        <Skeleton height={60} />
      ) : machines.length === 0 ? (
        <EmptyState title="No machines have synced yet" />
      ) : (
        <View>
          {machines.map((m) => (
            <KeyValue
              key={m.machineId}
              label={`${m.label}${m.userId === me ? " (you)" : ` · ${names.get(m.userId as string) ?? "—"}`}`}
              value={formatRelative(m.lastSyncAt, now)}
              sub={`${m.platform}${m.arch ? ` · ${m.arch}` : ""} · Codex ${m.codexVersion ?? "—"}`}
            />
          ))}
        </View>
      )}
    </SectionCard>
  );
}

export default function Settings() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "You";
  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={name} imageUrl={user?.imageUrl ?? null} size={44} />
          <View style={{ flex: 1 }}>
            <Muted style={{ fontSize: 15, fontWeight: "600" }}>{name}</Muted>
            {user?.primaryEmailAddress ? (
              <Muted>{user.primaryEmailAddress.emailAddress}</Muted>
            ) : null}
          </View>
          <Button
            title="Sign out"
            variant="outline"
            icon="log-out-outline"
            onPress={() => void signOut()}
          />
        </View>
      </Card>
      <SectionCard title="Appearance">
        <SegmentedControl
          label="Theme"
          options={THEMES}
          value={preference}
          onChange={setPreference}
        />
      </SectionCard>
      <SyncTokens />
      <Machines />
      <Prices />
      <SectionCard
        title="About"
        description="codex-kaboo mobile · the same Convex backend and Clerk accounts as the web dashboard."
      >
        <Muted>
          Only metadata ever leaves a machine: token counts, model names, tool kinds, skill names,
          project folder names, branches and timings. Never prompts, commands, file paths or diffs.
        </Muted>
      </SectionCard>
    </Screen>
  );
}
