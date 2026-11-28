import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field, SelectField } from "@/domain/data";
import { request } from "@/domain/registry";
import { formatWeatherTime } from "@/domain/weather";
import { CropLifecycle } from "@/features/irrigation/CropLifecycle";
import { CropProgress } from "@/features/irrigation/CropProgress";
import {
  DailyWaterBalance,
  show,
  type DecisionInput,
  type Result,
} from "@/features/irrigation/DailyWaterBalance";
type Settings = {
  measured_at?: string | null;
  derived?: boolean;
  taw_mm: number;
  initial_depletion_mm: number;
  allowable_depletion: number;
  efficiency: number;
  surface_taw_mm: number;
  surface_raw_mm: number;
  initial_surface_depletion_mm: number;
  soil_ece_ds_m: number | null;
  canal: { first_date: string; cycle_days: number; hours: number; flow_m3_hour: number } | null;
  tubewell: {
    flow_m3_hour: number;
    hours_per_day: number;
    pkr_hour: number;
    energy?: {
      fuel: "electricity" | "diesel";
      units_per_hour: number;
      pkr_per_unit: number;
    } | null;
  } | null;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";

function Numeric({
  name,
  label,
  value,
  min = 0,
  max,
  step = "any",
  required = true,
}: {
  name: string;
  label: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number | "any";
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        required={required}
      />
    </label>
  );
}

function FieldIrrigation({ path, field }: { path: string; field: Field }) {
  const [settings, setSettings] = useState<Settings | null>();
  const [settingsStatus, setSettingsStatus] = useState("Loading settings…");
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [planStatus, setPlanStatus] = useState("");
  const [planAttempt, setPlanAttempt] = useState(0);
  const [pumpFuel, setPumpFuel] = useState<"direct" | "electricity" | "diesel">("direct");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [decisionStatus, setDecisionStatus] = useState("");
  const canal = field.source.toLowerCase().includes("canal");
  const tubewell = field.source.toLowerCase().includes("tubewell");
  useEffect(() => {
    let active = true;
    request<Settings | null>(`${path}/irrigation-settings`)
      .then((data) => {
        if (active) {
          setSettings(data);
          setPumpFuel(data?.tubewell?.energy?.fuel ?? "direct");
          setSettingsStatus("");
        }
      })
      .catch((error) => {
        if (active) setSettingsStatus(errorText(error));
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, [path, settingsAttempt]);

  // The backend runs the recommended plan automatically on the baseline forecast.
  // Officers no longer enter scenario assumptions; they review the modeled result.
  useEffect(() => {
    if (!settings) return;
    const controller = new AbortController();
    const load = () => {
      setPlanStatus("Calculating the recommended plan…");
      request<Result>(`${path}/simulate`, "POST", {}, controller.signal)
        .then((fresh) => {
          if (!controller.signal.aborted) {
            setResult(fresh);
            setPlanStatus("");
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setResult(undefined);
            setPlanStatus(errorText(error));
          }
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) load();
    }, 300_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, Boolean(settings), planAttempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const n = (key: string) => Number(values.get(key));
    const firstDate = String(values.get("canal_date") ?? "");
    const salinity = String(values.get("soil_ece") ?? "");
    const data: Record<string, unknown> = {
      canal:
        canal && firstDate
          ? {
              first_date: firstDate,
              cycle_days: n("canal_cycle"),
              hours: n("canal_hours"),
              flow_m3_hour: n("canal_flow"),
            }
          : null,
      tubewell:
        tubewell && n("pump_flow")
          ? {
              flow_m3_hour: n("pump_flow"),
              hours_per_day: n("pump_hours"),
              pkr_hour: n("pump_price"),
              energy:
                pumpFuel === "direct"
                  ? null
                  : {
                      fuel: pumpFuel,
                      units_per_hour: n("energy_units"),
                      pkr_per_unit: n("energy_price"),
                    },
            }
          : null,
    };
    // Soil-water parameters are only sent when the officer opens Advanced to override the
    // derived FAO-56 defaults; otherwise the backend derives them from crop and soil.
    if (advanced) {
      data.taw_mm = n("taw");
      data.initial_depletion_mm = n("depletion");
      data.allowable_depletion = n("allowable");
      data.efficiency = n("efficiency");
      data.surface_taw_mm = n("surface_taw");
      data.surface_raw_mm = n("surface_raw");
      data.initial_surface_depletion_mm = n("surface_depletion");
      data.soil_ece_ds_m = salinity === "" ? null : Number(salinity);
    }
    setBusy(true);
    setSettingsStatus("");
    try {
      const measurement = advanced ? String(values.get("measured_at") ?? "") : "";
      const query = measurement
        ? "?" + new URLSearchParams({ measured_at: new Date(measurement + "+05:00").toISOString() })
        : "";
      setSettings(await request<Settings>(`${path}/irrigation-settings${query}`, "PUT", data));
      setSettingsStatus("Water supply saved.");
      setPlanAttempt((attempt) => attempt + 1);
    } catch (error) {
      setSettingsStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(day: string, input: DecisionInput) {
    setBusy(true);
    setDecisionStatus("Recalculating the plan…");
    try {
      setResult(await request<Result>(`${path}/irrigation-decisions/${day}`, "PUT", input));
      setDecisionStatus("Decision saved and water balance recalculated.");
      return true;
    } catch (error) {
      setDecisionStatus(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="Water supply"
        subtitle="Record the canal turn or tubewell. Soil-water values are derived from the crop and soil."
      >
        {settings !== undefined && (
          <form onSubmit={save}>
            {!canal && !tubewell && (
              <p role="status">
                This field is registered as rain-fed, so there is no canal or tubewell to configure.
              </p>
            )}
            {canal && (
              <fieldset className="form-grid">
                <legend>Warabandi turn</legend>
                <label>
                  First scheduled turn
                  <input name="canal_date" type="date" defaultValue={settings?.canal?.first_date} />
                </label>
                <Numeric
                  name="canal_cycle"
                  label="Days between turns"
                  value={settings?.canal?.cycle_days ?? 7}
                  min={1}
                  max={60}
                  step={1}
                />
                <Numeric
                  name="canal_hours"
                  label="Turn duration (hours)"
                  value={settings?.canal?.hours}
                  max={24}
                  required={false}
                />
                <Numeric
                  name="canal_flow"
                  label="Canal flow (m³/hour)"
                  value={settings?.canal?.flow_m3_hour}
                  required={false}
                />
              </fieldset>
            )}
            {tubewell && (
              <fieldset className="form-grid">
                <legend>Tubewell</legend>
                <Numeric
                  name="pump_flow"
                  label="Pump flow (m³/hour)"
                  value={settings?.tubewell?.flow_m3_hour}
                  required={false}
                />
                <Numeric
                  name="pump_hours"
                  label="Maximum pumping hours/day"
                  value={settings?.tubewell?.hours_per_day}
                  max={24}
                  required={false}
                />
                <label>
                  Pumping cost basis
                  <select
                    value={pumpFuel}
                    onChange={(event) => setPumpFuel(event.target.value as typeof pumpFuel)}
                  >
                    <option value="direct">Direct hourly rate</option>
                    <option value="electricity">Electricity</option>
                    <option value="diesel">Diesel</option>
                  </select>
                </label>
                {pumpFuel === "direct" ? (
                  <Numeric
                    name="pump_price"
                    label="Running cost (PKR/hour)"
                    value={settings?.tubewell?.pkr_hour}
                    required={false}
                  />
                ) : (
                  <>
                    <Numeric
                      name="energy_units"
                      key={pumpFuel}
                      label={
                        pumpFuel === "diesel"
                          ? "Diesel use (litres/hour)"
                          : "Electricity use (kWh/hour)"
                      }
                      min={0.001}
                      max={10_000}
                      value={
                        settings?.tubewell?.energy?.fuel === pumpFuel
                          ? settings.tubewell.energy.units_per_hour
                          : undefined
                      }
                    />
                    <Numeric
                      name="energy_price"
                      key={pumpFuel + "price"}
                      label={
                        pumpFuel === "diesel"
                          ? "Diesel price (PKR/litre)"
                          : "Electricity tariff (PKR/kWh)"
                      }
                      max={100_000}
                      value={
                        settings?.tubewell?.energy?.fuel === pumpFuel
                          ? settings.tubewell.energy.pkr_per_unit
                          : undefined
                      }
                    />
                  </>
                )}
              </fieldset>
            )}
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(event) => setAdvanced(event.target.checked)}
              />
              Advanced: override the derived FAO-56 soil-water values
            </label>
            {advanced && (
              <div className="form-grid">
                <Numeric
                  name="taw"
                  label="Root-zone total available water (mm)"
                  value={settings?.taw_mm}
                  min={0.1}
                  max={1200}
                  required={false}
                />
                <Numeric
                  name="depletion"
                  label="Current root-zone depletion (mm)"
                  value={settings?.initial_depletion_mm}
                  required={false}
                />
                <Numeric
                  name="allowable"
                  label="Allowable depletion fraction"
                  value={settings?.allowable_depletion ?? 0.5}
                  min={0.01}
                  max={0.99}
                  required={false}
                />
                <Numeric
                  name="efficiency"
                  label="Application efficiency (fraction)"
                  value={settings?.efficiency}
                  min={0.01}
                  max={1}
                  required={false}
                />
                <Numeric
                  name="surface_taw"
                  label="Total evaporable surface water (mm)"
                  value={settings?.surface_taw_mm ?? 20}
                  min={0.1}
                  max={80}
                  required={false}
                />
                <Numeric
                  name="surface_raw"
                  label="Readily evaporable surface water (mm)"
                  value={settings?.surface_raw_mm ?? 8}
                  required={false}
                />
                <Numeric
                  name="surface_depletion"
                  label="Current surface depletion (mm)"
                  value={settings?.initial_surface_depletion_mm}
                  required={false}
                />
                <label>
                  Soil-water measurement time (PKT)
                  <input name="measured_at" type="datetime-local" />
                  <small>
                    {settings?.measured_at
                      ? "Last recorded " + formatWeatherTime(settings.measured_at) + " PKT"
                      : "Record this when you physically measure depletion."}
                  </small>
                </label>
                <Numeric
                  name="soil_ece"
                  label="Lab root-zone soil salinity ECe (dS/m)"
                  value={settings?.soil_ece_ds_m ?? undefined}
                  max={100}
                  required={false}
                />
              </div>
            )}
            <Button type="submit" disabled={busy}>
              Save water supply
            </Button>
            {settings?.derived && !advanced && (
              <small>Soil-water values are modeled FAO-56 defaults from the crop and soil type.</small>
            )}
          </form>
        )}
        {settingsStatus && <p role="status">{settingsStatus}</p>}
        {settings === undefined && !loadingSettings && (
          <Button
            onClick={() => {
              setLoadingSettings(true);
              setSettingsStatus("Loading settings…");
              setSettingsAttempt((attempt) => attempt + 1);
            }}
          >
            Retry loading water supply
          </Button>
        )}
      </Card>
      <CropProgress key={path} path={path} />
      <CropLifecycle path={path} />
      <Card
        title="Recommended irrigation plan"
        subtitle={
          result
            ? `${result.recommended} · ${result.weather_source} forecast ${formatWeatherTime(result.weather_retrieved_at)} PKT`
            : `${field.crop} · ${field.stage}`
        }
      >
        {planStatus ? (
          <p role="status">{planStatus}</p>
        ) : result ? (
          <>
            {result.weather_fallback_reason && (
              <p>Weather fallback · {result.weather_fallback_reason}</p>
            )}
            {result.soil_inputs_source && <p>{result.soil_inputs_source}</p>}
            {result.warnings.map((warning) => (
              <p role="status" key={warning}>
                {warning}
              </p>
            ))}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Pumping cost (PKR)</th>
                    <th>Stress score</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.plans).map(([name, plan]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{show(plan.cost_pkr)}</td>
                      <td>{show(plan.stress_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DailyWaterBalance
              result={result}
              busy={busy}
              canReview={!planStatus}
              onDecision={decide}
            />
            {decisionStatus && <p role="status">{decisionStatus}</p>}
          </>
        ) : (
          <p role="status">Loading the recommended plan…</p>
        )}
      </Card>
    </>
  );
}

export default function FieldIntelligence({
  field,
  fields,
  open,
  openMap,
}: {
  field?: Field;
  fields: Field[];
  open: SelectField;
  openMap: () => void;
}) {
  const path = `/fields/${encodeURIComponent(field?.id ?? "")}`;
  return (
    <>
      <PageTitle
        eyebrow="FIELD INTELLIGENCE"
        title="Irrigation Intelligence"
        description={
          field
            ? `PI-Advisor water balance and irrigation decisions for ${field.name}.`
            : "Register a field to use its location and crop records."
        }
      >
        {field && <FieldSelect fields={fields} id={field.id} onChange={open} />}
      </PageTitle>
      {field ? (
        <FieldIrrigation key={path} path={path} field={field} />
      ) : (
        <Empty
          title="No registered field selected"
          text="Go to the Farm Map to draw and register a field."
          action={<Button onClick={openMap}>Open Farm Map</Button>}
        />
      )}
    </>
  );
}
