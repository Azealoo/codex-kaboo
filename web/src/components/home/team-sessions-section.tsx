"use client";

import { SessionsTable } from "@/components/user/sessions-table";

/** The whole team's recent threads, newest first, with who ran each one. */
export function TeamSessionsSection() {
  return (
    <SessionsTable
      title="Sessions"
      description="Every teammate's threads, newest first, independent of the selected range."
    />
  );
}
