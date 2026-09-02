import type { UserRef } from "@convex/lib/types";
import { AvatarName } from "@/components/primitives/avatar-name";
import { Badge } from "@/components/ui/badge";

export function UserHeader({ user, isMe, color }: { user: UserRef; isMe: boolean; color: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <AvatarName name={user.name} imageUrl={user.imageUrl} color={color} size="lg" hideName />
      <div>
        <h1 className="text-xl font-semibold">{isMe ? "My Page" : user.name}</h1>
        <p className="text-sm text-muted-foreground">{isMe ? user.name : "Team member"}</p>
      </div>
      {isMe ? (
        <Badge variant="outline" className="ml-auto rounded-full">
          You
        </Badge>
      ) : null}
    </div>
  );
}
