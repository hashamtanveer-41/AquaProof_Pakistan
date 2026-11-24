import { useState } from "react";
import { Droplets, FlaskConical, Play, SlidersHorizontal, Sprout, Sun, Waves } from "lucide-react";
import { acres, forecastDays, localWeather, number, pkr } from "@/domain/data";
import type { Field, SelectField } from "@/domain/data";
import { baseline, simulate } from "@/domain/irrigation";
import type { Scenario } from "@/domain/irrigation";
import { Button, Card, Chip, Demo, Details, LineChart, PageTitle, Stat } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";

export default function Irrigation({
  field,
  fields,
  open,
}: {
  field: Field;
  fields: Field[];
  open: SelectField;
}) {
  const map = localWeather(field);
  const hasCanal = field.source.includes("Canal"),
    hasPump = field.source.includes("Tubewell");
  const [config, setConfig] = useState<Scenario>(() => baseline(field));
  const [result, setResult] = useState(config);
  const [runs, setRuns] = useState(0);
  const updated = config !== result;
  const set = <T extends keyof Scenario>(key: T, value: Scenario[T]) =>
    setConfig((previous) => ({ ...previous, [key]: value }));
  const { best, volume, demand, compare, series, without } = simulate(field, result);
  return (
    <>
      <PageTitle
        eyebrow="WATER MANAGEMENT"
        title="Irrigation Intelligence"
        description="Compare water strategies using field-specific conditions and adjustable scenario assumptions."
      >
        <Demo>Modeled demo only</Demo>
        <FieldSelect fields={fields} id={field.id} onChange={(id) => open(id)} />
      </PageTitle>
      <div className="stats-grid map-stats">
        <Stat
          icon={<Sprout size={21} />}
          label={`${field.crop} · ${field.name}`}
          value={
            <>
              {acres(field.acres)} <small>acres</small>
            </>
          }
          note={`${field.soil} · ${field.stage}`}
        />
        <Stat
          icon={<Sun size={21} />}
          tone="blue"
          label="Local weather snapshot"
          value={`${map.temperature}°C`}
          note={`${map.humidity}% humidity · ${map.wind} km/h wind · ET₀ ${map.eto} mm/day`}
        />
        <Stat
          icon={<Droplets size={21} />}
          tone="amber"
          label="Estimated soil-water depletion"
          value={`${map.depletion}%`}
          note="Synthetic baseline · 20 Mar 2026"
        />
      </div>
      <div className="grid-2 sim-grid">
        <div className="stack">
          <Card
            title="Scenario controls"
            subtitle="Change inputs and run a comparison."
            action={
              <span className="mini-icon">
                <SlidersHorizontal size={16} />
              </span>
            }
          >
            <form
              className="scenario-form"
              onSubmit={(e) => {
                e.preventDefault();
                setResult(config);
                setRuns(runs + 1);
              }}
            >
              <label>
                Expected rainfall <span>{config.rain} mm</span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={config.rain}
                  onChange={(e) => set("rain", +e.target.value)}
                />
              </label>
              <label>
                Canal availability
                <select
                  value={config.canal ? "available" : "unavailable"}
                  disabled={!hasCanal}
                  onChange={(e) => set("canal", e.target.value === "available")}
                >
                  <option value="available">Scheduled supply available</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label>
                Canal delay <span>{config.delay} days</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  disabled={!config.canal}
                  value={config.delay}
                  onChange={(e) => set("delay", +e.target.value)}
                />
              </label>
              <label>
                Tubewell operating cost (PKR/h)
                <input
                  type="number"
                  min="0"
                  max="25000"
                  required
                  disabled={!hasPump}
                  value={config.rate}
                  onChange={(e) => set("rate", +e.target.value)}
                />
              </label>
              <label>
                Irrigation amount (mm)
                <input
                  type="number"
                  min="5"
                  max="100"
                  required
                  value={config.amount}
                  onChange={(e) => set("amount", +e.target.value)}
                />
              </label>
              <label>
                Proposed irrigation date
                <input
                  type="date"
                  min="2026-03-20"
                  max="2026-04-10"
                  required
                  value={config.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </label>
              <Button variant="primary" type="submit">
                <Play size={16} /> Run Simulation
              </Button>
              <small role="status">
                {updated
                  ? "Changes not yet applied."
                  : runs
                    ? `Scenario ${runs} applied.`
                    : "Baseline scenario displayed."}
              </small>
            </form>
          </Card>
          <Card title="Field and water availability">
            <Details
              rows={[
                ["Planted on", field.planted],
                [
                  "Canal schedule",
                  hasCanal ? `${map.canalDay} · synthetic` : "No canal connection",
                ],
                ["Canal supply", hasCanal ? "Scheduled · not verified" : "Unavailable"],
                ["Tubewell", hasPump ? `${pkr(field.rate)} / hour` : "Unavailable"],
                ["Forecast rainfall", `${map.rain} mm · synthetic`],
              ]}
            />
          </Card>
        </div>
        <div className="stack">
          <Card
            title="Strategy comparison"
            subtitle="Relative trade-offs using the last applied scenario."
            action={<Demo />}
          >
            <div className="strategies">
              {compare.map((s) => (
                <div
                  className={`strategy ${best?.type === s.type ? "recommended" : ""} ${s.valid ? "" : "unavailable"}`}
                  key={s.title}
                >
                  <div>
                    <span className="mini-icon">
                      {s.type === 0 ? (
                        <Waves size={17} />
                      ) : s.type === 1 ? (
                        <Droplets size={17} />
                      ) : (
                        <Sprout size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{s.title}</strong>
                      <small>
                        {s.valid
                          ? `${s.date} · ${s.risk}% peak depletion · ${pkr(s.cost)} pumping`
                          : "Unavailable in this scenario"}
                      </small>
                    </div>
                    {best?.type === s.type && <Chip>Recommended</Chip>}
                  </div>
                </div>
              ))}
            </div>
            <div className="notice">
              <FlaskConical size={18} />
              <span>
                {best ? (
                  <>
                    <strong>{number(volume)} m³ modeled water requirement.</strong>{" "}
                    {best.type === 0
                      ? "Waiting avoids pumping expenses within the demo scoring model."
                      : best.type === 1
                        ? "Pumping limits modeled depletion when canal timing is too late or supply is unavailable."
                        : "Partial pumping reduces near-term depletion while reserving most delivery for the canal turn."}
                  </>
                ) : demand === 0 ? (
                  "Effective rainfall covers the requested irrigation depth in this scenario. Confirm actual soil moisture before making decisions."
                ) : (
                  "No water source is available under the current scenario. Confirm supply before planning irrigation."
                )}
              </span>
            </div>
          </Card>
          <Card
            title="Predicted soil-water depletion"
            subtitle="First seven days · lower values indicate more available water"
          >
            <LineChart
              data={series}
              secondary={best ? without : undefined}
              labels={forecastDays}
              unit="%"
            />
            <div className="chart-legend">
              <span>
                <i /> {best ? "Recommended strategy" : "No irrigation"}
              </span>
              {best && (
                <span>
                  <i className="amber" /> No irrigation
                </span>
              )}
            </div>
          </Card>
          {compare.some((s) => s.valid) && (
            <Card
              title="Pumping cost comparison"
              subtitle="Modeled variable expenses only; excludes canal fees and labor."
            >
              <div className="crop-bars">
                {compare
                  .filter((s) => s.valid)
                  .map((s) => (
                    <div key={s.type}>
                      <div>
                        <strong>{s.title}</strong>
                        <span>{pkr(s.cost)}</span>
                      </div>
                      <progress
                        aria-label={`${s.title}: ${pkr(s.cost)}`}
                        value={s.cost}
                        max={Math.max(1, ...compare.filter((o) => o.valid).map((o) => o.cost))}
                      />
                    </div>
                  ))}
              </div>
            </Card>
          )}
          <Card title="Model assumptions and uncertainty">
            <p className="body-copy">
              This simplified comparison uses a synthetic forecast and canal schedule. It assumes
              65% effective rainfall and a 160 m³/h pump, and adds a demonstration penalty for
              depletion above 54% when ranking strategies. Soil moisture, field flow, and forecast
              accuracy have not been verified. Do not use these values as field instructions.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
