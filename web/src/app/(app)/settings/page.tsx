"use client";

import { PageHeader } from "@/components/layout/page-header";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { InstallCard } from "@/components/settings/install-card";
import { MachinesCard } from "@/components/settings/machines-card";
import { PricesCard } from "@/components/settings/prices-card";
import { SyncTokensCard } from "@/components/settings/sync-tokens-card";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description="Sync tokens, collector install, machines and model prices." />
      <SectionErrorBoundary title="Tokens could not load">
        <SyncTokensCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Install instructions could not load">
        <InstallCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Machines could not load">
        <MachinesCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Prices could not load">
        <PricesCard />
      </SectionErrorBoundary>
    </div>
  );
}
