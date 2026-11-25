import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field } from "@/domain/data";

export default function FieldHistory({
  field,
  fields,
  select,
  openMap,
}: {
  field?: Field;
  fields: Field[];
  select: (id: string) => void;
  openMap: () => void;
}) {
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
    </>
  );
}
