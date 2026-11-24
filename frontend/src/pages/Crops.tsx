import { useState } from "react";
import { acres, regionData } from "@/domain/data";
import type { Field, Region, SelectField } from "@/domain/data";
import { Card, Chip, Demo, Empty, PageTitle, TextAction } from "@/components/ui";

export default function Crops({
  fields,
  region,
  open,
}: {
  fields: Field[];
  region: Region;
  open: SelectField;
}) {
  const [crop, setCrop] = useState("");
  const filtered = fields.filter((f) => f.region === region && (!crop || f.crop === crop));
  return (
    <>
      <PageTitle
        eyebrow="LAND & FIELD MANAGEMENT"
        title="Crop Monitoring"
        description="Track planting dates, estimated crop stages, and field activities by season."
      >
        <Demo />
      </PageTitle>
      <Card
        title="Current crop season"
        subtitle={regionData[region].district}
        action={
          <select
            aria-label="Filter by crop"
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
          >
            <option value="">All crops</option>
            {[...new Set(fields.map((f) => f.crop))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        }
      >
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Current crop</th>
                  <th>Previous crop</th>
                  <th>Planted</th>
                  <th>Estimated stage</th>
                  <th>Mapped area</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <TextAction onClick={() => open(f.id, "profile")}>{f.name}</TextAction>
                    </td>
                    <td>
                      <Chip>{f.crop}</Chip>
                    </td>
                    <td>{f.previous}</td>
                    <td>{f.planted}</td>
                    <td>{f.stage}</td>
                    <td>{acres(f.acres)} ac</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No fields match this crop"
            text="Choose a different crop or switch region."
          />
        )}
      </Card>
    </>
  );
}
