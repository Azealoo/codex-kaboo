import { Suspense, type ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { TopNav, TopNavFallback } from "@/components/layout/top-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <Suspense fallback={<TopNavFallback />}>
        <TopNav />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </AppGate>
  );
}
