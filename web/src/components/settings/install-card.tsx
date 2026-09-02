"use client";

import { CopyBox } from "@/components/primitives/copy-box";
import { SectionCard } from "@/components/primitives/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrigin } from "@/hooks/use-origin";
import { INSTALL_OS, installSteps } from "@/lib/install";

export function InstallCard() {
  const origin = useOrigin() ?? "https://<this dashboard>";
  return (
    <SectionCard
      title="Install the collector"
      description="Runs every 15 minutes and uploads metadata only: token counts, model names, tool kinds, skill names, project folder names, branches and timings. Never prompts, commands, file paths or diffs."
    >
      <Tabs defaultValue="macos">
        <TabsList>
          {INSTALL_OS.map((os) => (
            <TabsTrigger key={os.id} value={os.id}>
              {os.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {INSTALL_OS.map((os) => (
          <TabsContent key={os.id} value={os.id} className="flex flex-col gap-3 pt-3">
            {installSteps(os.id, origin).map((step, i) => (
              <div key={step.title} className="flex flex-col gap-1">
                <CopyBox label={`${i + 1}. ${step.title}`} value={step.command} />
                {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Re-running the install command upgrades the collector in place.
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </SectionCard>
  );
}
