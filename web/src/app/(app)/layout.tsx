import { Suspense, type ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { InvalidRangeNotice } from "@/components/layout/invalid-range-notice";
import { TopNav, TopNavFallback } from "@/components/layout/top-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <Suspense fallback={<TopNavFallback />}>
        <TopNav />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        {/* In the layout rather than per page: the range lives in the URL and applies to every
            route under it, so a rejected one has to be explained wherever the user landed. */}
        <Suspense fallback={null}>
          <InvalidRangeNotice className="mb-4" />
        </Suspense>
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </AppGate>
  );
}
