import { useState } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import type { Field } from "@/domain/data";
import { AssistantMonitor } from "./AssistantMonitor";

export default function LiveAdvisory({
  fields,
  selectedFieldId,
  openMap,
}: {
  fields: Field[];
  selectedFieldId?: string;
  openMap: () => void;
}) {
  const [selection, setSelection] = useState("");
  const field = fields.find((item) => item.id === (selection || selectedFieldId)) ?? fields[0];
  return (
    <>
      <PageTitle
        eyebrow="FARMER COMMUNICATIONS"
        title="Advisory Center"
        description="Send WhatsApp messages, review farmer replies and monitor daily advisories."
      />
      {field ? (
        <>
          <Card title="Field">
            <label>
              Registered field
              <select value={field.id} onChange={(event) => setSelection(event.target.value)}>
                {fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </Card>
          <AssistantMonitor key={field.id} field={field} />
        </>
      ) : (
        <Empty
          title="No registered fields"
          text="Register a field to start a conversation."
          action={<Button onClick={openMap}>Open Farm Map</Button>}
        />
      )}
    </>
  );
}
