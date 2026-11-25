"use client";

import { useWorkspace } from "@/context/WorkspaceContext";
import Crops from "@/views/Crops";

export default function CropsPage() {
  const { fields, region, openField, replaceField } = useWorkspace();

  return (
    <Crops
      key={region}
      fields={fields}
      region={region}
      open={openField}
      onSeasonSaved={replaceField}
    />
  );
}
