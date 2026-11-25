"use client";

import { useWorkspace } from "@/context/WorkspaceContext";
import { FarmMap } from "@/features/map/FarmMap";

export default function MapPage() {
  const {
    region,
    pickRegion,
    fields,
    farmers,
    mapField,
    openField,
    setRegistration,
    draft,
    setDraft,
    editing,
    setEditing,
    saveBoundary,
    notify,
  } = useWorkspace();

  return (
    <FarmMap
      region={region}
      setRegion={pickRegion}
      fields={fields}
      farmers={farmers}
      field={mapField}
      selectField={openField}
      onProfile={() => mapField && openField(mapField.id, "profile")}
      onRegister={() => setRegistration({})}
      draft={draft}
      setDraft={setDraft}
      editing={editing}
      setEditing={setEditing}
      onSave={saveBoundary}
      notify={notify}
    />
  );
}
