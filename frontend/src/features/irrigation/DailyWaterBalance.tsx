import { useState, type FormEvent } from "react";
import { Button, Chip, LineChart } from "@/components/ui";

export type DecisionAction = "accept" | "skip" | "edit" | "reopen";
type Decision = { action: DecisionAction; revision: number; canal_m3: number; pump_m3: number };

export type Plan = {
  cost_pkr: number;
  stress_score: number;
  daily: {
    date: string;
    stage: string;
    active_crop: boolean;
    crop_et_mm: number;
    potential_transpiration_mm: number;
    soil_evaporation_mm: number;
    rain_mm: number;
    canal_m3: number;
    pump_m3: number;
    depletion_mm: number;
    stress_mm: number;
    unmet_et_mm: number;
    root_zone_available_mm: number;
    excess_water_mm: number;
    pump_hours: number;
    max_c?: number | null;
    precip_probability_pct?: number | null;
  }[];
};

export type Result = {
  weather_source: string;
  weather_retrieved_at: string;
  weather_fallback_reason?: string | null;
  soil_inputs_source?: string;
  soil_measured_at?: string | null;
  warnings: string[];
  recommended: string;
  plans: Record<string, Plan>;
  readily_available_mm: number;
  crop: string;
  season_id: number;
  decisions: Record<string, Decision>;
  reviewed_plan: Plan | null;
  decision_conflicts: string[];
  canal_capacity_m3: number[];
  pump_capacity_m3: number[];
};

export type DecisionInput = {
  action: DecisionAction;
  season_id: number;
  revision: number;
  canal_m3?: number;
  pump_m3?: number;
};

const label: Record<DecisionAction, string> = {
  accept: "Accepted",
  skip: "Skipped",
  edit: "Adjusted",
  reopen: "Open for review",
};

export const show = (value?: number | null) =>
  value == null ? "Unavailable" : value.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export function DailyWaterBalance({
  result,
  busy,
  canReview,
  onDecision,
}: {
  result: Result;
  busy: boolean;
  canReview: boolean;
  onDecision: (day: string, input: DecisionInput) => Promise<boolean>;
}) {
  const baseline = result.plans[result.recommended];
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const index = baseline.daily.findIndex((day) => day.date === selected);
  const chosen = baseline.daily[index];
  const saved = result.decisions[selected];
  const reviewed = result.reviewed_plan;
  const days = (reviewed ?? baseline).daily;

  async function record(action: DecisionAction, amounts?: { canal_m3: number; pump_m3: number }) {
    if (!chosen) return;
    const planned = { canal_m3: chosen.canal_m3, pump_m3: chosen.pump_m3 };
    const success = await onDecision(chosen.date, {
      action,
      season_id: result.season_id,
      revision: saved?.revision ?? 0,
      ...(action === "accept" ? planned : amounts),
    });
    if (success) setEditing(false);
  }

  function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void record("edit", {
      canal_m3: Number(values.get("canal")),
      pump_m3: Number(values.get("pump")),
    });
  }

  return (
    <section className="irrigation-balance">
      <h3>Root-zone water balance</h3>
      <p>
        {reviewed
          ? "The solid line includes saved decisions. The dashed line is the original recommendation."
          : "The solid line shows estimated depletion. The dashed line marks the readily available water threshold."}
      </p>
      <LineChart
        data={days.map((day) => Number(day.depletion_mm.toFixed(2)))}
        secondary={days.map((_, i) =>
          reviewed ? baseline.daily[i].depletion_mm : result.readily_available_mm,
        )}
        labels={days.map((day) => day.date.slice(5))}
        unit=" mm"
      />
      <h3>Forecast rain and crop water requirement</h3>
      <LineChart
        data={days.map((day) => day.crop_et_mm)}
        secondary={days.map((day) => day.rain_mm)}
        labels={days.map((day) => day.date.slice(5))}
        unit=" mm"
      />
      <p>
        Solid line shows modeled water requirement. Dashed line shows rainfall under this scenario.
      </p>
      {reviewed && (
        <p>
          Reviewed pumping cost {show(reviewed.cost_pkr)} PKR · Readily available water{" "}
          {show(result.readily_available_mm)} mm
        </p>
      )}
      {result.decision_conflicts.length > 0 && (
        <p role="alert">
          Saved decisions exceed the available supply on {result.decision_conflicts.join(", ")}.
          Review those dates under the baseline.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Crop stage</th>
              <th>Potential crop ET (mm)</th>
              <th>Rain (mm)</th>
              <th>Canal (m³)</th>
              <th>Tubewell (m³ / h)</th>
              <th>Root-zone water (mm)</th>
              <th>Depletion (mm)</th>
              <th>Unmet ET (mm)</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.stage}</td>
                <td
                  title={`Potential transpiration ${show(day.potential_transpiration_mm)} mm · Soil evaporation ${show(day.soil_evaporation_mm)} mm`}
                >
                  {show(day.crop_et_mm)}
                </td>
                <td>{show(day.rain_mm)}</td>
                <td>{show(day.canal_m3)}</td>
                <td>
                  {show(day.pump_m3)} / {show(day.pump_hours)}
                </td>
                <td>{show(day.root_zone_available_mm)}</td>
                <td>{show(day.depletion_mm)}</td>
                <td>{show(day.unmet_et_mm)}</td>
                <td>
                  {result.decisions[day.date]
                    ? label[result.decisions[day.date].action]
                    : "Pending"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="irrigation-review">
        <h3>Review a daily irrigation decision</h3>
        <p>
          Record the farmer’s plan for the day. Future depletion and water allocation recalculate
          when the decision is saved.
        </p>
        {!canReview && (
          <p>
            Run the baseline with unchanged rainfall, canal timing, and pumping cost to save
            decisions.
          </p>
        )}
        <label>
          Forecast day
          <select
            value={selected}
            disabled={busy || !canReview}
            onChange={(event) => {
              setSelected(event.target.value);
              setEditing(false);
            }}
          >
            <option value="">Choose a forecast day</option>
            {days
              .filter((day) => day.active_crop)
              .map((day) => (
                <option key={day.date}>{day.date}</option>
              ))}
          </select>
        </label>
        {chosen && canReview && (
          <>
            <p>
              Suggested {show(chosen.canal_m3)} m³ canal and {show(chosen.pump_m3)} m³ tubewell{" "}
              {saved && <Chip>{label[saved.action]}</Chip>}
            </p>
            <p>
              Forecast high {show(chosen.max_c)} °C · Rain probability{" "}
              {show(chosen.precip_probability_pct)}% · Modeled excess water{" "}
              {show(chosen.excess_water_mm)} mm.
            </p>
            <div className="field-actions">
              <Button disabled={busy} onClick={() => void record("accept")}>
                Accept recommendation
              </Button>
              <Button disabled={busy} onClick={() => void record("skip")}>
                Skip irrigation
              </Button>
              <Button disabled={busy} onClick={() => setEditing(!editing)}>
                Adjust volumes
              </Button>
              {saved && saved.action !== "reopen" && (
                <Button disabled={busy} onClick={() => void record("reopen")}>
                  Reopen decision
                </Button>
              )}
            </div>
            {editing && (
              <form className="form-grid" onSubmit={adjust}>
                <label>
                  Canal volume (m³)
                  <input
                    name="canal"
                    type="number"
                    min={0}
                    max={result.canal_capacity_m3[index]}
                    defaultValue={Math.min(
                      saved?.canal_m3 ?? chosen.canal_m3,
                      result.canal_capacity_m3[index],
                    )}
                    step="any"
                    required
                  />
                </label>
                <label>
                  Tubewell volume (m³)
                  <input
                    name="pump"
                    type="number"
                    min={0}
                    max={result.pump_capacity_m3[index]}
                    defaultValue={Math.min(
                      saved?.pump_m3 ?? chosen.pump_m3,
                      result.pump_capacity_m3[index],
                    )}
                    step="any"
                    required
                  />
                </label>
                <Button type="submit" variant="primary" disabled={busy}>
                  Save adjusted volumes
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}
