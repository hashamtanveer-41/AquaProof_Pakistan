"use client";

import { Card } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";
import Reports from "@/views/Reports";

export default function ReportsPage() {
  const { fields, farmers, openField, count } = useWorkspace();

  if (connected) {
    return (
      <Card title="Reports & History">
        <p>Live data for this page is pending integration.</p>
      </Card>
    );
  }

  return <Reports fields={fields} farmers={farmers} open={openField} advisoryCount={count} />;
}
