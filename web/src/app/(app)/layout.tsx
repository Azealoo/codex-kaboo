import { Suspense, type ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { BottomNav } from "@/components/layout/bottom-nav";
import { InvalidRangeNotice } from "@/components/layout/invalid-range-notice";
import { TopNav, TopNavFallback } from "@/components/layout/top-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <Suspense fallback={<TopNavFallback />}>
        <TopNav />
      </Suspense>
      {/* Bottom padding clears the phone tab bar (plus the home-indicator safe area) on small
          screens; from `md` up the bar is gone and the padding returns to normal. */}
      <main className="mx-auto w-full max-w-7xl px-3 py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6 md:px-6 md:pb-6">
        {/* In the layout rather than per page: the range lives in the URL and applies to every
            route under it, so a rejected one has to be explained wherever the user landed. */}
        <Suspense fallback={null}>
          <InvalidRangeNotice className="mb-4" />
        </Suspense>
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </AppGate>
  );
}
