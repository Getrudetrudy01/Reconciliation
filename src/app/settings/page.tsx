import { getSettings } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Defaults used to pre-fill a new reconciliation. Editable per-run on the Reconcile page."
      />
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5">
        <SettingsForm feeAmount={settings.feeAmount} tolerance={settings.tolerance} />
      </div>
    </div>
  );
}
