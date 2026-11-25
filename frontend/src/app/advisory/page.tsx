"use client";

import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";
import Advisory from "@/views/Advisory";
import LiveAdvisory from "@/views/LiveAdvisory";

export default function AdvisoryPage() {
  const {
    farmers,
    fields,
    farmer,
    fieldId,
    openFarmer,
    stage,
    setStageValue,
    notify,
    approveDemoAdvisory,
    replaceField,
  } = useWorkspace();

  if (connected) {
    return <LiveAdvisory fields={fields} selectedFieldId={fieldId} onFieldUpdated={replaceField} />;
  }

  return (
    <Advisory
      farmers={farmers}
      fields={fields}
      farmer={farmer}
      pick={openFarmer}
      log={stage}
      setLog={setStageValue}
      notify={notify}
      onApprove={approveDemoAdvisory}
    />
  );
}
