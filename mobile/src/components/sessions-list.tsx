import { Ionicons } from "@expo/vector-icons";
import { usePaginatedQuery } from "convex/react";
import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";
import { formatCompact, formatDateTime, formatPercent, formatUsd } from "@shared/format";
import { filterSessions } from "@/lib/sessions";
import { usePalette } from "@/providers/theme";
import { sourceLabel } from "./breakdowns";
import { SectionCard } from "./section-card";
import { Badge, Button, EmptyState, Muted, Skeleton } from "./ui";

const PAGE = 20;

export function SessionRowItem({ s, showUser }: { s: SessionRow; showUser: boolean }) {
  const p = usePalette();
  return (
    <Link href={{ pathname: "/session/[id]", params: { id: s.sessionId } }} asChild>
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) => ({
          paddingVertical: 10,
          gap: 4,
          opacity: pressed ? 0.7 : 1,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {s.inProgress ? (
            <View
              accessibilityLabel="In progress"
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.statusGood }}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: p.foreground, fontSize: 14, fontWeight: "600" }}
          >
            {s.project}
            {s.gitBranch ? (
              <Text style={{ color: p.mutedForeground, fontWeight: "400" }}> · {s.gitBranch}</Text>
            ) : null}
          </Text>
          <Text
            style={{
              color: p.foreground,
              fontSize: 13,
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatCompact(s.tokens.total)}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={p.mutedForeground} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Muted>{formatDateTime(s.startedAt)}</Muted>
          {showUser ? <Muted>· {s.userName}</Muted> : null}
          <Muted>· {s.model}</Muted>
          <Muted>· cache {formatPercent(s.cacheHitRate)}</Muted>
          <Muted>· {s.costUsd === null ? "unpriced" : formatUsd(s.costUsd)}</Muted>
          <Badge>{sourceLabel(s.source, s.isSubagent)}</Badge>
        </View>
      </Pressable>
    </Link>
  );
}

export function SessionsList({
  userId,
  title = "Sessions",
}: {
  userId?: Id<"users">;
  title?: string;
}) {
  const p = usePalette();
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listRecent,
    userId === undefined ? {} : { userId },
    { initialNumItems: PAGE },
  );
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterSessions(results, query), [results, query]);
  return (
    <SectionCard title={title} description="Newest first, independent of the selected range.">
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: 10,
          paddingHorizontal: 10,
        }}
      >
        <Ionicons name="search" size={14} color={p.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter project, branch, model…"
          placeholderTextColor={p.mutedForeground}
          accessibilityLabel="Filter sessions"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, paddingVertical: 8, color: p.foreground, fontSize: 14 }}
        />
      </View>
      {status === "LoadingFirstPage" ? (
        <Skeleton height={160} />
      ) : results.length === 0 ? (
        <EmptyState title="No sessions yet" />
      ) : (
        <View>
          {filtered.map((s) => (
            <SessionRowItem key={s.sessionId} s={s} showUser={userId === undefined} />
          ))}
          {query.trim() !== "" ? (
            <Muted style={{ paddingTop: 8 }}>
              {filtered.length} of {results.length} loaded sessions match.
            </Muted>
          ) : null}
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <View style={{ alignItems: "center", paddingTop: 12 }}>
              <Button
                title={status === "LoadingMore" ? "Loading…" : "Load more"}
                variant="outline"
                disabled={status === "LoadingMore"}
                onPress={() => loadMore(PAGE)}
              />
            </View>
          ) : null}
        </View>
      )}
    </SectionCard>
  );
}
