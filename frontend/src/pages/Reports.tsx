import { useMemo, useState } from "react";
import { ArrowDownToLine, CalendarDays, Droplets, Wallet } from "lucide-react";
import { number, pkr, regionData, regions } from "@/domain/data";
import type { Farmer, Field, SelectField } from "@/domain/data";
import { Button, Card, Demo, LineChart, PageTitle, Stat, TextAction } from "@/components/ui";

export default function Reports({
  fields,
  farmers,
  open,
  advisoryCount,
}: {
  fields: Field[];
  farmers: Farmer[];
  open: SelectField;
  advisoryCount: number;
}) {
  const [region, setRegion] = useState("");
  const [view, setView] = useState("Water use");
  const shown = fields.filter((f) => !region || f.region === region);
  const rows = useMemo(
    () =>
      shown.map((f) => ({
        f,
        owner: farmers.find((p) => p.id === f.farmerId)?.name ?? "Unknown",
        water: Math.round(f.acres * 4.0468564 * (f.crop === "Wheat" ? 30 : 22)),
        expense: f.source.includes("Tubewell") ? f.rate * 2 : 0,
      })),
    [shown, farmers],
  );
  function download() {
    const csv = (values: unknown[]) =>
      values
        .map(
          (v) =>
            `"${String(v)
              .replace(/^[=+\-@\t\r]/, (c) => `'${c}`)
              .replace(/"/g, '""')}"`,
        )
        .join(",");
    const output = [
      csv([
        "Field ID",
        "Farmer",
        "Province",
        "Crop",
        "Previous crop",
        "Irrigation source",
        "Modeled m³",
        "Modeled PKR",
        "Source",
      ]),
      ...rows.map(({ f, owner, water, expense }) =>
        csv([f.id, owner, f.region, f.crop, f.previous, f.source, water, expense, "Demo only"]),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([output], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "aquaproof-demo-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS & RECORDS"
        title="Reports & History"
        description="Review crop seasons, irrigation activity, environmental records, and modeled costs."
      >
        <Demo />
        <Button variant="primary" onClick={download}>
          <ArrowDownToLine size={16} /> Export CSV
        </Button>
      </PageTitle>
      <div className="stats-grid map-stats">
        <Stat
          icon={<Droplets size={20} />}
          label="Modeled water use"
          value={
            <>
              {number(rows.reduce((s, r) => s + r.water, 0))} <small>m³</small>
            </>
          }
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Modeled tubewell expense"
          value={pkr(rows.reduce((s, r) => s + r.expense, 0))}
        />
        <Stat
          icon={<CalendarDays size={20} />}
          label="Approved demo advisories"
          value={advisoryCount}
        />
      </div>
      <Card
        title="History by field"
        subtitle="Export uses the current province filter."
        action={
          <select
            aria-label="Filter history by province"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">All provinces</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        }
      >
        <div className="segmented">
          {["Water use", "Crop seasons", "Weather & canal", "Advisories"].map((v) => (
            <button className={view === v ? "active" : ""} onClick={() => setView(v)} key={v}>
              {v}
            </button>
          ))}
        </div>
        {view === "Water use" && (
          <LineChart
            data={rows.map((r) => r.water)}
            labels={rows.map((_, i) => `Field ${i + 1}`)}
            unit=" m³"
          />
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Field / farmer</th>
                <th>District</th>
                <th>
                  {view === "Crop seasons"
                    ? "Current crop"
                    : view === "Weather & canal"
                      ? "Reference network"
                      : view === "Advisories"
                        ? "Communication channel"
                        : "Modeled water"}
                </th>
                <th>
                  {view === "Crop seasons"
                    ? "Previous crop"
                    : view === "Weather & canal"
                      ? "Reference schedule"
                      : view === "Advisories"
                        ? "Conversation"
                        : "Modeled expense"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, owner, water, expense }) => (
                <tr key={f.id}>
                  <td>
                    <TextAction onClick={() => open(f.id, "profile")}>{f.name}</TextAction>
                    <small>{owner}</small>
                  </td>
                  <td>{regionData[f.region].district}</td>
                  <td>
                    {view === "Crop seasons"
                      ? f.crop
                      : view === "Weather & canal"
                        ? regionData[f.region].canal
                        : view === "Advisories"
                          ? "Simulated email"
                          : `${number(water)} m³`}
                  </td>
                  <td>
                    {view === "Crop seasons" ? (
                      f.previous
                    ) : view === "Weather & canal" ? (
                      `${regionData[f.region].canalDay} · synthetic`
                    ) : view === "Advisories" ? (
                      <TextAction onClick={() => open(f.id, "advisory")}>Open thread</TextAction>
                    ) : (
                      pkr(expense)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
