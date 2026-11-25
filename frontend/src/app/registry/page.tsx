"use client";

import { useWorkspace } from "@/context/WorkspaceContext";
import Registry from "@/views/Registry";

export default function RegistryPage() {
  const { farmers, fields, openFarmer, setRegistration } = useWorkspace();

  return (
    <Registry
      farmers={farmers}
      fields={fields}
      open={(id) => openFarmer(id, "profile")}
      onRegister={() => setRegistration({})}
    />
  );
}
