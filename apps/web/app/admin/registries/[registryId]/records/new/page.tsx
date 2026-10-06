import { notFound } from "next/navigation";

import { AdminRecordForm } from "../../../../../../components/admin-record-form";
import { AdminShell } from "../../../../../../components/admin-shell";
import {
  requireAdminSession,
} from "../../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../../lib/admin-console";
import {
  createAdminRecord,
} from "../../../../actions";

export const dynamic = "force-dynamic";

interface NewRecordPageProps {
  params: Promise<{
    registryId: string;
  }>;
  searchParams: Promise<{
    type?: string;
    error?: string;
  }>;
}

export default async function NewRecordPage({
  params,
  searchParams,
}: NewRecordPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const recordTypeId =
    query.type ??
    registry.config.definition
      .defaultRecordTypeId ??
    registry.config.definition.recordTypes[0]
      ?.id;

  if (!recordTypeId) notFound();

  let recordType;
  try {
    recordType =
      registry.config.getRecordType(
        recordTypeId,
      );
  } catch {
    notFound();
  }

  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId);

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title={"New " + recordType.definition.name}
      subtitle="Create a canonical record from the registry schema. Lifecycle-managed records always begin in the configured initial status."
    >
      {query.error ? (
        <div className="admin-message admin-message--error">
          {query.error}
        </div>
      ) : null}
      <AdminRecordForm
        registryId={registryId}
        recordType={recordType}
        action={createAdminRecord}
        returnTo={returnTo}
        submitLabel="Create record"
      />
    </AdminShell>
  );
}
