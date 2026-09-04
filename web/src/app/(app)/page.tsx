"use client";

import { useQueryState } from "nuqs";
import { PageHeader } from "@/components/layout/page-header";
import { ShellSkeleton } from "@/components/layout/app-gate";
import { ModelsSection } from "@/components/home/models-section";
import { OnboardingCard } from "@/components/home/onboarding-card";
import { OverviewCards } from "@/components/home/overview-cards";
import { ProjectsSection } from "@/components/home/projects-section";
import { SkillsSection } from "@/components/home/skills-section";
import { TeamSessionsSection } from "@/components/home/team-sessions-section";
import { ToolsSection } from "@/components/home/tools-section";
import { TrendSection } from "@/components/home/trend-section";
import { UsersSection } from "@/components/home/users-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { useRange } from "@/hooks/use-range";
import { SECTIONS, VIEWS, sectionParser, viewParser, type Section } from "@/lib/search-params";

const SECTION_OPTIONS = SECTIONS.map((s) => ({
  value: s,
  label: s[0]!.toUpperCase() + s.slice(1),
}));
const VIEW_OPTIONS = VIEWS.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));

function SectionBody({
  section,
  range,
}: {
  section: Section;
  range: NonNullable<ReturnType<typeof useRange>["resolved"]>;
}) {
  switch (section) {
    case "users":
      return <UsersSection range={range} />;
    case "models":
      return <ModelsSection range={range} />;
    case "tools":
      return <ToolsSection range={range} />;
    case "projects":
      return <ProjectsSection range={range} />;
    case "skills":
      return <SkillsSection range={range} />;
    case "sessions":
      return <TeamSessionsSection />;
  }
}

export default function HomePage() {
  const { resolved } = useRange();
  const [section, setSection] = useQueryState("section", sectionParser);
  const [view, setView] = useQueryState("view", viewParser);
  if (resolved === null) return <ShellSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description={`${resolved.label} · ${resolved.days} day${resolved.days === 1 ? "" : "s"}`}
        actions={
          <SegmentedControl
            ariaLabel="View"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(v) => void setView(v)}
          />
        }
      />
      <SectionErrorBoundary title="Overview could not load">
        <OnboardingCard />
        <OverviewCards range={resolved} view={view} />
      </SectionErrorBoundary>
      <SegmentedControl
        ariaLabel="Section"
        options={SECTION_OPTIONS}
        value={section}
        onChange={(s) => void setSection(s)}
        size="default"
        className="self-start"
      />
      <SectionErrorBoundary>
        <SectionBody section={section} range={resolved} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Trends could not load">
        <TrendSection range={resolved} />
      </SectionErrorBoundary>
    </div>
  );
}
