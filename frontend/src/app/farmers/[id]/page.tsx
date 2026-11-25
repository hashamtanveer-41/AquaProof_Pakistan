"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Button, Empty } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import Profile from "@/views/Profile";

export default function FarmerProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : "";
  const {
    farmers,
    fields,
    field,
    openField,
    go,
    stage,
    setDraftOwner,
    setDraft,
    selectFarmerById,
  } = useWorkspace();

  const currentFarmer = farmers.find((f) => f.id === id);

  useEffect(() => {
    if (id && currentFarmer) selectFarmerById(id);
  }, [id, currentFarmer, selectFarmerById]);

  if (!currentFarmer) {
    return (
      <Empty
        title="Farmer not found"
        text="This farmer record could not be found in the current registry."
        action={
          <Button variant="primary" onClick={() => go("registry")}>
            Back to Farmers Registry
          </Button>
        }
      />
    );
  }

  return (
    <Profile
      farmer={currentFarmer}
      fields={fields}
      field={field}
      open={openField}
      go={go}
      draw={() => {
        go("map");
        setDraftOwner(currentFarmer.id);
        setDraft([]);
      }}
      advisoryCount={stage[currentFarmer.id]?.stage === "sent" ? 1 : 0}
    />
  );
}
