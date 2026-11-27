import { useEffect, useState } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field } from "@/domain/data";
import { request } from "@/domain/registry";

export default function FieldHistory({
  field,
  fields,
  select,
  openMap,
  onDelete,
}: {
  field?: Field;
  fields: Field[];
  select: (id: string) => void;
  openMap: () => void;
  onDelete: (id: string, permanentName: string) => Promise<boolean>;
}) {
  const [archived, setArchived] = useState<{ id: string; name: string }[]>();
  const [archiveError, setArchiveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ id: string; name: string }[]>(
      "/registry/archived-fields",
      "GET",
      undefined,
      controller.signal,
    )
      .then(setArchived)
      .catch(() => {
        if (!controller.signal.aborted) setArchiveError("Archived fields could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  async function removeArchived(item: { id: string; name: string }) {
    setDeleting(true);
    try {
      if (await onDelete(item.id, item.name))
        setArchived((items) => items?.filter((field) => field.id !== item.id));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Reports & History"
        description="Recorded crop seasons and approved irrigation reports."
      />
      {field ? (
        <Card
          title="Field activity"
          subtitle={field.name}
          action={<FieldSelect id={field.id} fields={fields} onChange={select} />}
        >
          {field.history.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Record</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {[...field.history].reverse().map((event, index) => (
                    <tr key={event.date + event.label + index}>
                      <td>{event.date}</td>
                      <td>{event.label}</td>
                      <td>{event.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No activity recorded"
              text="Planting and approved farmer reports will appear here."
            />
          )}
        </Card>
      ) : (
        <Empty
          title="No registered fields"
          text="Choose or register a farm on the map."
          action={<Button onClick={openMap}>Open Farm Map</Button>}
        />
      )}
      <Card title="Archived fields">
        {archiveError ? (
          <p role="status">{archiveError}</p>
        ) : archived?.length ? (
          <ul className="stack">
            {archived.map((item) => (
              <li key={item.id} className="field-actions">
                <span>{item.name}</span>
                <Button disabled={deleting} onClick={() => void removeArchived(item)}>
                  Delete permanently
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{archived ? "No archived fields." : "Loading archived fields…"}</p>
        )}
      </Card>
    </>
  );
}
