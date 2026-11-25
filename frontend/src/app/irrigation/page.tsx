"use client";

import { Card } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";
import Irrigation from "@/views/Irrigation";

export default function IrrigationPage() {
  const { mapField, fields, openField } = useWorkspace();

  if (connected) {
    return (
      <Card title="Irrigation Intelligence">
        <p>Live data for this page is pending integration.</p>
      </Card>
    );
  }

  if (!mapField) return null;

  return <Irrigation key={mapField.id} field={mapField} fields={fields} open={openField} />;
}
