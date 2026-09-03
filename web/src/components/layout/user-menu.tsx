"use client";

import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";

export function UserMenu() {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          label="Settings"
          labelIcon={<Settings className="size-4" />}
          href="/settings"
        />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
