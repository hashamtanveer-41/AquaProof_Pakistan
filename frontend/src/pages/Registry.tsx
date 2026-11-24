import { useState } from "react";
import { ArrowRight, Search, Users } from "lucide-react";
import { acres, demoRegion, regions } from "@/domain/data";
import type { Farmer, Field } from "@/domain/data";
import { Button, Card, Chip, Demo, Empty, PageTitle } from "@/components/ui";
import { connected } from "@/domain/registry";

export default function Registry({
  farmers,
  fields,
  open,
  onRegister,
}: {
  farmers: Farmer[];
  fields: Field[];
  open: (id: string) => void;
  onRegister: () => void;
}) {
  const [q, setQ] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [crop, setCrop] = useState("");
  const [source, setSource] = useState("");
  const filtered = farmers.filter((f) => {
    const plots = fields.filter((p) => p.farmerId === f.id);
    return (
      `${f.name} ${f.id} ${f.village} ${f.email}`.toLowerCase().includes(q.toLowerCase()) &&
      (!province || f.region === province) &&
      (!district || demoRegion(f.region).district === district) &&
      ((!crop && !source) ||
        plots.some((p) => (!crop || p.crop === crop) && (!source || p.source === source)))
    );
  });
  return (
    <>
      <PageTitle
        eyebrow="LAND & FIELD MANAGEMENT"
        title="Farmers Registry"
        description="Search farmer records, review registered fields, and manage contact information."
      >
        <Button variant="primary" onClick={onRegister}>
          <Users size={16} /> Register Farmer
        </Button>
      </PageTitle>
      <Card
        title="Registered farmers"
        subtitle={`${filtered.length} of ${farmers.length} ${connected ? "records" : "demo records"}`}
        action={connected ? undefined : <Demo />}
      >
        <div className="filters">
          <label className="label-inline search">
            <Search size={16} />
            <input
              aria-label="Search farmers"
              placeholder="Search farmer, ID, or village…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label={connected ? "Region" : "Province"}
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              setDistrict("");
            }}
          >
            <option value="">{connected ? "All regions" : "All provinces"}</option>
            {(connected
              ? [...new Set(farmers.map((farmer) => farmer.region).sort())]
              : regions
            ).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {!connected && (
            <select
              aria-label="District"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            >
              <option value="">All districts</option>
              {regions
                .filter((r) => !province || r === province)
                .map((r) => (
                  <option key={r}>{demoRegion(r).district}</option>
                ))}
            </select>
          )}
          <select aria-label="Crop" value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option value="">All crops</option>
            {[...new Set(fields.map((f) => f.crop))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Irrigation source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All water sources</option>
            {[...new Set(fields.map((f) => f.source))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Farmer</th>
                  <th>{connected ? "Region" : "District"}</th>
                  <th>Village</th>
                  <th>Fields</th>
                  <th>Total area</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const plots = fields.filter((p) => p.farmerId === f.id);
                  return (
                    <tr key={f.id}>
                      <td>
                        <button className="table-person" onClick={() => open(f.id)}>
                          <i>
                            {f.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </i>
                          <span>
                            <strong>{f.name}</strong>
                            <small>{f.id}</small>
                          </span>
                        </button>
                      </td>
                      <td>{connected ? f.region : demoRegion(f.region).district}</td>
                      <td>{f.village}</td>
                      <td>{plots.length}</td>
                      <td>{acres(plots.reduce((total, p) => total + p.acres, 0))} ac</td>
                      <td>
                        <Chip dot>{plots.length ? "Registered" : "No fields"}</Chip>
                      </td>
                      <td>
                        <button
                          className="bare-button"
                          onClick={() => open(f.id)}
                          aria-label={`View ${f.name}`}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No farmers found"
            text="Try another search or reset your filters."
            action={
              <Button
                onClick={() => {
                  setQ("");
                  setProvince("");
                  setDistrict("");
                  setCrop("");
                  setSource("");
                }}
              >
                Reset filters
              </Button>
            }
          />
        )}
      </Card>
    </>
  );
}
