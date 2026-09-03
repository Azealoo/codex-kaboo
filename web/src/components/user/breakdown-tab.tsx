"use client";

import type { Id } from "@convex/_generated/dataModel";
import { ModelsSection } from "@/components/home/models-section";
import { ProjectsSection } from "@/components/home/projects-section";
import { SkillsSection } from "@/components/home/skills-section";
import { ToolsSection } from "@/components/home/tools-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import type { ResolvedRange } from "@/lib/range";
import { MachinesTable } from "./machines-table";
import { SourcesTable } from "./sources-table";
import { TimeAnalysisCard } from "./time-analysis-card";

export function BreakdownTab({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionErrorBoundary>
        <TimeAnalysisCard range={range} userId={userId} />
      </SectionErrorBoundary>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionErrorBoundary>
          <ModelsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ToolsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ProjectsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SkillsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <MachinesTable range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SourcesTable range={range} userId={userId} />
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
