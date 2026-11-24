import { useState } from "react";
import { acres, demoRegion } from "@/domain/data";
import type { Field, Region, SelectField } from "@/domain/data";
import { Button, Card, Chip, Demo, Empty, PageTitle, TextAction } from "@/components/ui";
import { connected, startSeason } from "@/domain/registry";

export default function Crops({
  fields,
  region,
  open,
  openMap,
  onSeasonSaved,
}: {
  fields: Field[];
  region: Region;
  open: SelectField;
  openMap: () => void;
  onSeasonSaved: (field: Field) => void;
}) {
  const [crop, setCrop] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const regionFields = fields.filter((field) => !region || field.region === region);
  const filtered = regionFields.filter((field) => !crop || field.crop === crop);
  return (
    <>
      <PageTitle
        eyebrow="LAND & FIELD MANAGEMENT"
        title="Crop Monitoring"
        description="Track planting dates, estimated crop stages, and field activities by season."
      >
        {!connected && <Demo />}
      </PageTitle>
      {connected && regionFields.length > 0 && (
        <Card title="Start a crop season">
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              const form = event.currentTarget;
              const values = new FormData(form);
              setSaving(true);
              setStatus("");
              try {
                onSeasonSaved(
                  await startSeason(
                    String(values.get("field")),
                    String(values.get("crop")),
                    String(values.get("variety")).trim(),
                    String(values.get("planted")),
                  ),
                );
                form.reset();
                setCrop("");
                setStatus("Crop season saved.");
              } catch (error) {
                setStatus(
                  error instanceof Error ? error.message : "Crop season could not be saved.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              Field
              <select name="field" required>
                {regionFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Crop
              <input name="crop" required maxLength={160} />
            </label>
            <label>
              Variety
              <input name="variety" maxLength={160} />
            </label>
            <label>
              Planting date
              <input name="planted" type="date" required />
            </label>
            <button className="button" disabled={saving}>
              Save season
            </button>
            {status && <p role="status">{status}</p>}
          </form>
        </Card>
      )}
      <Card
        title="Current crop season"
        subtitle={connected ? region || "All locations" : demoRegion(region).district}
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
        ) : !regionFields.length ? (
          <Empty
            title="No fields in this location"
            text="Register a field on the Farm Map before starting a crop season."
            action={<Button onClick={openMap}>Open Farm Map</Button>}
          />
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
