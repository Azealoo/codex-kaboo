import { Screen } from "@/components/screen";
import { Skeleton } from "@/components/ui";
import { UserDashboard } from "@/components/user-dashboard";
import { useCurrentUserId } from "@/providers/current-user";
import { useRange } from "@/providers/range";

export default function MyPage() {
  const me = useCurrentUserId();
  const { resolved, today } = useRange();
  if (resolved === null)
    return (
      <Screen>
        <Skeleton height={120} />
        <Skeleton height={240} />
      </Screen>
    );
  return (
    <Screen>
      <UserDashboard range={resolved} userId={me} today={today} />
    </Screen>
  );
}
