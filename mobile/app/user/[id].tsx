import { useQuery } from "convex/react";
import { Stack, useLocalSearchParams } from "expo-router";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Screen } from "@/components/screen";
import { EmptyState, Skeleton } from "@/components/ui";
import { UserDashboard } from "@/components/user-dashboard";
import { useRange } from "@/providers/range";

export default function UserPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = id as Id<"users">;
  const users = useQuery(api.users.list, {});
  const { resolved, today } = useRange();
  const user = users?.find((u) => u.userId === userId);
  return (
    <>
      <Stack.Screen options={{ title: user?.name ?? "Teammate" }} />
      <Screen>
        {users === undefined || resolved === null ? (
          <Skeleton height={240} />
        ) : !user ? (
          <EmptyState
            title="User not found"
            description="This user has not signed in to the dashboard."
          />
        ) : (
          <UserDashboard range={resolved} userId={userId} today={today} />
        )}
      </Screen>
    </>
  );
}
