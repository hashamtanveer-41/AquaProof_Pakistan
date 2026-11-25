"use client";

import { Card } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";
import Weather from "@/views/Weather";

export default function WeatherPage() {
  const { region, fields, mapField, openField } = useWorkspace();

  if (connected) {
    return (
      <Card title="Weather & Canal Data">
        <p>Live data for this page is pending integration.</p>
      </Card>
    );
  }

  if (!mapField) return null;

  return <Weather region={region} fields={fields} field={mapField} open={openField} />;
}
