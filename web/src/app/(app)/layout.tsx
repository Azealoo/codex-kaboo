import type { ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center px-4 md:px-6">
          <span className="text-sm font-semibold">codex-kaboo</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</main>
    </AppGate>
  );
}
