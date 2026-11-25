"use client";

import { Card, Details } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";
import Overview from "@/views/Overview";

export default function OverviewPage() {
  const { region, fields, farmers, openField, go, pendingCount } = useWorkspace();

  if (connected) {
    return (
      <Card title="Registry overview">
        <Details
          rows={[
            ["Registered farmers", farmers.filter((farmer) => farmer.region === region).length],
            ["Mapped fields", fields.filter((field) => field.region === region).length],
          ]}
        />
      </Card>
    );
  }

  return (
    <Overview
      region={region}
      fields={fields}
      farmers={farmers}
      open={openField}
      go={go}
      pending={pendingCount}
    />
  );
}
