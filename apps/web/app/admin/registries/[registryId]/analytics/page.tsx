import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "../../../../../components/analytics-dashboard";
import { AdminShell } from "../../../../../components/admin-shell";
import {
  requireAdminSession,
} from "../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../lib/admin-console";
import {
  getRepositories,
} from "../../../../../lib/database";

export const dynamic = "force-dynamic";

interface AdminAnalyticsPageProps {
  params: Promise<{
    registryId: string;
  }>;
}

export default async function AdminAnalyticsPage({
  params,
}: AdminAnalyticsPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const snapshot =
    await getRepositories().analytics.getSnapshot(
      registry.config,
      {
        scope: "administrative",
      },
    );

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Registry analytics"
      subtitle="Internal operational analytics include non-public lifecycle states and administrative obligations. They remain restricted to authenticated operators."
    >
      <AnalyticsDashboard snapshot={snapshot} />
    </AdminShell>
  );
}
