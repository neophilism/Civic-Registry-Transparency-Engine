import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "../../../../components/analytics-dashboard";
import { Breadcrumbs } from "../../../../components/breadcrumbs";
import {
  getPublicRegistry,
} from "../../../../lib/public-registry";
import { getRepositories } from "../../../../lib/database";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  params: Promise<{
    registryId: string;
  }>;
}

export async function generateMetadata({
  params,
}: AnalyticsPageProps): Promise<Metadata> {
  const { registryId } = await params;
  const registry = await getPublicRegistry(registryId);

  return {
    title: registry
      ? `Analytics · ${registry.config.definition.name}`
      : "Analytics",
  };
}

export default async function AnalyticsPage({
  params,
}: AnalyticsPageProps) {
  const { registryId } = await params;
  const registry = await getPublicRegistry(registryId);

  if (!registry) notFound();

  const snapshot =
    await getRepositories().analytics.getSnapshot(
      registry.config,
      {
        scope: "public",
      },
    );

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href:
              "/registries/" +
              encodeURIComponent(registryId),
          },
          { label: "Analytics" },
        ]}
      />

      <header className="page-heading">
        <p className="eyebrow">
          Public registry analytics
        </p>
        <h1>Transparency at a glance</h1>
        <p className="lede">
          Aggregate activity, deadlines, evidence
          coverage, and configured registry
          dimensions. Public analytics use the same
          lifecycle, visibility, and disclosure
          boundaries as public records.
        </p>
      </header>

      <AnalyticsDashboard snapshot={snapshot} />
    </main>
  );
}
