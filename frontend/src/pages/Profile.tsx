import { ArrowLeft, ArrowRight, Sprout } from "lucide-react";
import { acres } from "@/domain/data";
import type { Farmer, Field, Page, SelectField } from "@/domain/data";
import { GeoCanvas } from "@/features/map/GeoCanvas";
import { Button, Card, Chip, Details, Empty, PageTitle, TextAction } from "@/components/ui";

export default function Profile({
  farmer,
  fields,
  field,
  open,
  go,
  draw,
}: {
  farmer: Farmer;
  fields: Field[];
  field?: Field;
  open: SelectField;
  go: (page: Page) => void;
  draw: () => void;
}) {
  const plots = fields.filter((f) => f.farmerId === farmer.id);
  const selected = plots.find((f) => f.id === field?.id) ?? plots[0];
  return (
    <>
      <button className="back-link" onClick={() => go("registry")}>
        <ArrowLeft size={15} /> Farmers Registry
      </button>
      <PageTitle
        eyebrow={`FARMER PROFILE · ${farmer.id}`}
        title={farmer.name}
        description={`${farmer.village} · ${farmer.region}`}
      >
        <Chip dot>Registered farmer</Chip>
        <Button onClick={() => selected && open(selected.id, "advisory")} disabled={!selected}>
          Open conversation <ArrowRight size={16} />
        </Button>
      </PageTitle>
      <div className="grid-2 profile-grid">
        <div className="stack">
          <Card title="Farmer information">
            <Details
              rows={[
                ["Farmer ID", farmer.id],
                ["Email", farmer.email || "Not provided"],
                ["Phone", farmer.phone || "Not provided"],
                ["Region", farmer.region],
                ["Village", farmer.village],
                ["Total mapped area", `${acres(plots.reduce((sum, f) => sum + f.acres, 0))} ac`],
              ]}
            />
          </Card>
          <Card
            title="Registered fields"
            subtitle="Each field keeps its own crop and irrigation history."
            action={<TextAction onClick={draw}>Add field</TextAction>}
          >
            <div className="field-list">
              {plots.map((f) => (
                <button
                  key={f.id}
                  className={f.id === selected?.id ? "active" : ""}
                  onClick={() => open(f.id, "profile")}
                >
                  <span className="mini-icon">
                    <Sprout size={16} />
                  </span>
                  <span>
                    <strong>{f.name}</strong>
                    <small>
                      {f.id} · {f.crop}
                    </small>
                  </span>
                  <b>{acres(f.acres)} ac</b>
                </button>
              ))}
            </div>
            {!plots.length && (
              <Empty
                title="No mapped fields"
                text="Draw a boundary and link the saved field to this farmer."
                action={<Button onClick={draw}>Draw a field</Button>}
              />
            )}
          </Card>
          <Card title="Advisory history" subtitle="Officer-reviewed communications">
            {selected && (
              <TextAction onClick={() => open(selected.id, "advisory")}>
                Open conversation
              </TextAction>
            )}
          </Card>
        </div>
        <div className="stack">
          {selected && (
            <>
              <Card
                className="embedded-map profile-map"
                title={selected.name}
                subtitle={`${selected.id} · ${acres(selected.acres)} acres`}
                action={
                  <TextAction onClick={() => open(selected.id, "map")}>View on map</TextAction>
                }
              >
                <GeoCanvas
                  key={selected.region}
                  fields={plots}
                  selected={selected.id}
                  onSelect={(id) => open(id, "profile")}
                />
              </Card>
              <Card title="Field and water records">
                <Details
                  rows={[
                    ["Current crop", selected.crop],
                    ["Previous crop", selected.previous],
                    ["Soil type", selected.soil],
                    ["Planting date", selected.planted],
                    ["Estimated stage", selected.stage],
                    ["Water source", selected.source],
                  ]}
                />
              </Card>
              <Card
                title="Crop lifecycle"
                subtitle="Planting, irrigation, fertilizer and harvest milestones"
              >
                <div className="timeline">
                  {[
                    ...selected.history,
                    {
                      date: "Pending",
                      label: "Harvest review",
                      detail: "Harvest date to be confirmed by the officer",
                    },
                  ].map((event, i) => (
                    <div key={i}>
                      <i />
                      <span>
                        <strong>{event.label}</strong>
                        <small>{event.detail}</small>
                      </span>
                      <time>{event.date}</time>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
