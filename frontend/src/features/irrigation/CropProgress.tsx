import { useEffect, useState } from "react";
import { Button, Card, Chip } from "@/components/ui";
import { request } from "@/domain/registry";
import { formatWeatherTime } from "@/domain/weather";

type Stage = {
  name: string;
  starts_on: string;
  ends_before: string;
  length_days: number;
  status: "complete" | "current" | "upcoming";
  day_in_stage: number;
  progress_pct: number;
  kc: number;
};

type Progress =
  | { status: "planting_date_required" | "calendar_unavailable" }
  | {
      status: "modeled";
      crop: string;
      variety: string | null;
      planting_date: string;
      as_of: string;
      current_stage: string;
      day_in_stage: number;
      progress_pct: number;
      modeled_maturity: string;
      season_length_days: number;
      confidence: string;
      source: string;
      stages: Stage[];
    };

type WaterStage = {
  name: string;
  length_days: number;
  kc: number;
  etc_mm_per_day: number;
  crop_water_mm: number;
  gross_mm: number;
  volume_m3: number;
  runtime_hours: number | null;
  basis: string;
};

type WaterPlan =
  | { status: "input_required"; missing: string[]; guidance: string }
  | { status: "out_of_season"; crop: string; guidance: string }
  | {
      status: "ready";
      crop: string;
      area_m2: number;
      efficiency: number;
      water_source: string;
      current_stage: string;
      progress_pct: number;
      reference_eto_mm: { value: number; source: string; retrieved_at: string; label: string };
      stages: WaterStage[];
      water_now: {
        date: string;
        net_mm: number;
        gross_mm: number;
        canal_m3: number;
        pump_m3: number;
        volume_m3: number;
        runtime_hours: number | null;
        cost_pkr: number | null;
        source_label: string;
      };
      next_irrigation_date: string | null;
      runtime_hours: number | null;
      weather_source: string;
      weather_retrieved_at: string;
      soil_measured_at: string | null;
    };

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";

function useEndpoint<T>(path: string, retry: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(undefined);
    request<T>(path, "GET", undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      });
    return () => controller.abort();
  }, [path, retry]);
  return { data, error };
}

function StageBar({ stages, label }: { stages: Stage[]; label: string }) {
  const total = stages.reduce((sum, stage) => sum + stage.length_days, 0) || 1;
  return (
    <div
      className="stage-bar"
      role="img"
      aria-label={`Crop stage progress: ${label}. ${stages
        .map((stage) => `${stage.name} ${stage.status}`)
        .join(", ")}.`}
    >
      {stages.map((stage) => (
        <div
          key={stage.name}
          className={`stage-bar-cell ${stage.status}`}
          style={{ flexGrow: stage.length_days / total }}
        >
          <span className="stage-bar-track">
            {stage.status === "current" && (
              <span className="stage-bar-fill" style={{ width: `${stage.progress_pct}%` }} />
            )}
          </span>
          <strong>{stage.name}</strong>
          <small>
            {stage.length_days} d · Kc {stage.kc.toFixed(2)}
            {stage.status === "current" ? ` · day ${stage.day_in_stage}` : ""}
          </small>
        </div>
      ))}
    </div>
  );
}

const MISSING_TEXT: Record<string, string> = {
  crop: "Record the crop and planting date in Crop Monitoring.",
  measurements: "Save the field inputs with a soil-water measurement time above.",
  supply: "Enter the registered canal turn or tubewell pump flow (m³/hour) above.",
};

type Harvest =
  | { status: "planting_date_required" | "calendar_unavailable" }
  | {
      status: "modeled";
      crop: string;
      readiness: "immature" | "approaching" | "ready" | "overdue";
      recommendation:
        | "monitor"
        | "prepare"
        | "harvest_before_rain"
        | "await_dry_window"
        | "harvest_window_open";
      current_stage: string;
      modeled_maturity: string;
      days_to_maturity: number;
      rain_coming: boolean;
      next_wet_date: string | null;
      dry_days: string[];
      harvest_before: string | null;
      forecast_available: boolean;
      weather_source: string;
      weather_retrieved_at: string;
    };

const HARVEST_TEXT: Record<string, string> = {
  monitor: "Not ready to harvest yet. Keep monitoring crop maturity.",
  prepare: "Harvest is approaching. Arrange labour and dry storage; confirm grain in the field.",
  harvest_before_rain:
    "Crop is near/at harvest and rain is forecast. Advise harvesting during the dry days before the rain.",
  await_dry_window:
    "Crop is ready but rain is forecast now. Advise waiting for the first dry break and protecting cut crop.",
  harvest_window_open:
    "Crop is at harvest and the next days look dry. Advise harvesting now and not delaying.",
};

const HARVEST_TONE: Record<string, string> = {
  harvest_before_rain: "amber",
  await_dry_window: "amber",
  harvest_window_open: "green",
  prepare: "blue",
  monitor: "neutral",
};

export function CropProgress({ path }: { path: string }) {
  const [retry, setRetry] = useState(0);
  const progress = useEndpoint<Progress>(`${path}/crop-progress`, retry);
  const plan = useEndpoint<WaterPlan>(`${path}/water-plan`, retry);
  const harvest = useEndpoint<Harvest>(`${path}/harvest-window`, retry);
  const error = progress.error || plan.error || harvest.error;

  if (error) {
    return (
      <Card title="Crop progress and water need">
        <div role="alert">
          {error} <Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>
        </div>
      </Card>
    );
  }

  const p = progress.data;
  const w = plan.data;
  const h = harvest.data;
  return (
    <>
      <Card
        title="Crop progress and water need"
        subtitle="Deterministic FAO-56 crop-stage timeline and today's modeled irrigation."
      >
        {p?.status === "modeled" ? (
          <>
            <p>
              {[p.crop, p.variety].filter(Boolean).join(" · ")} · <strong>{p.current_stage}</strong>
              , day {p.day_in_stage} · {p.progress_pct}% of season · modeled maturity{" "}
              {p.modeled_maturity}
            </p>
            <StageBar stages={p.stages} label={p.current_stage} />
            <small>
              Source: {p.source} FAO-56 crop calendar ({p.confidence}). Local cultivar review
              required.
            </small>
          </>
        ) : (
          <p role="status">
            {p?.status === "calendar_unavailable"
              ? "A crop calendar is unavailable for this crop."
              : p
                ? "Record the crop and planting date in Crop Monitoring to model the stages."
                : "Loading crop progress…"}
          </p>
        )}

        {w?.status === "ready" ? (
          <>
            <div className="water-now">
              <h3>Water needed now</h3>
              <div className="water-now-grid">
                <div>
                  <span className="stat-label">Net depth</span>
                  <strong>{w.water_now.net_mm} mm</strong>
                </div>
                <div>
                  <span className="stat-label">Gross volume</span>
                  <strong>{w.water_now.volume_m3} m³</strong>
                </div>
                <div>
                  <span className="stat-label">Tubewell runtime</span>
                  <strong>
                    {w.water_now.runtime_hours == null ? "—" : `${w.water_now.runtime_hours} h`}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Next irrigation</span>
                  <strong>{w.next_irrigation_date ?? "No pumping in forecast"}</strong>
                </div>
              </div>
              <p>
                <Chip tone="blue">{w.water_source}</Chip>{" "}
                <Chip tone="neutral">{w.water_now.source_label}</Chip>
                {w.water_now.cost_pkr != null && <> · Pumping cost {w.water_now.cost_pkr} PKR</>}
              </p>
              <small>
                {w.weather_source} forecast retrieved {formatWeatherTime(w.weather_retrieved_at)}{" "}
                PKT · Reference ET₀ {w.reference_eto_mm.value} mm/day ({w.reference_eto_mm.label}) ·{" "}
                {w.soil_measured_at
                  ? `Soil measured ${formatWeatherTime(w.soil_measured_at)} PKT`
                  : "Soil measurement time unrecorded"}
              </small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Days</th>
                    <th>Kc</th>
                    <th>ETc (mm/day)</th>
                    <th>Crop water (mm)</th>
                    <th>Gross (mm)</th>
                    <th>Volume (m³)</th>
                    <th>Tubewell (h)</th>
                  </tr>
                </thead>
                <tbody>
                  {w.stages.map((stage) => (
                    <tr key={stage.name}>
                      <td>{stage.name}</td>
                      <td>{stage.length_days}</td>
                      <td>{stage.kc.toFixed(2)}</td>
                      <td>{stage.etc_mm_per_day}</td>
                      <td>{stage.crop_water_mm}</td>
                      <td>{stage.gross_mm}</td>
                      <td>{stage.volume_m3}</td>
                      <td>{stage.runtime_hours == null ? "—" : stage.runtime_hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>
              Per-stage figures are synthetic gross crop water requirement at the forecast ET₀ and{" "}
              {Math.round(w.efficiency * 100)}% application efficiency over {w.area_m2} m² (PostGIS
              geodesic area). They are planning estimates, not a post-rain root-zone balance.
            </small>
          </>
        ) : w?.status === "input_required" ? (
          <p role="status">
            {w.guidance}
            {w.missing
              .map((item) => MISSING_TEXT[item])
              .filter(Boolean)
              .map((text) => (
                <span key={text} className="water-missing">
                  {text}
                </span>
              ))}
          </p>
        ) : w?.status === "out_of_season" ? (
          <p role="status">{w.guidance}</p>
        ) : (
          <p role="status">Loading the water plan…</p>
        )}
      </Card>
      <Card
        title="Harvest timing"
        subtitle="Modeled crop maturity compared against the rain forecast."
      >
        {h?.status === "modeled" ? (
          <>
            <p>
              <Chip tone={HARVEST_TONE[h.recommendation] ?? "neutral"}>{h.readiness}</Chip>{" "}
              {HARVEST_TEXT[h.recommendation]}
            </p>
            <div className="water-now-grid">
              <div>
                <span className="stat-label">Modeled maturity</span>
                <strong>{h.modeled_maturity}</strong>
              </div>
              <div>
                <span className="stat-label">Days to maturity</span>
                <strong>{h.days_to_maturity}</strong>
              </div>
              <div>
                <span className="stat-label">
                  {h.harvest_before ? "Harvest before" : "Next wet day"}
                </span>
                <strong>{h.harvest_before ?? h.next_wet_date ?? "None in forecast"}</strong>
              </div>
            </div>
            <small>
              Maturity is a modeled FAO-56 estimate; rain is a forecast. {h.weather_source}{" "}
              retrieved {formatWeatherTime(h.weather_retrieved_at)} PKT. Confirm grain moisture in
              the field.
            </small>
          </>
        ) : h ? (
          <p role="status">
            Record the crop and planting date in Crop Monitoring to model harvest timing.
          </p>
        ) : (
          <p role="status">Loading harvest timing…</p>
        )}
      </Card>
    </>
  );
}
