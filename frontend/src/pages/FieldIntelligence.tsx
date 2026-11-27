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
type Scenario = {
  rain_factor: number;
  canal_delay_days: number;
  pump_pkr_hour: number | null;
  canal_supply_factor: number;
  pump_available_from: string | null;
  pump_hours_cap: number | null;
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
  const [scenarioStatus, setScenarioStatus] = useState("");
  const [pumpFuel, setPumpFuel] = useState<"direct" | "electricity" | "diesel">("direct");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [scenario, setScenario] = useState<Scenario>();
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

  useEffect(() => {
    if (!scenario || busy) return;
    let controller: AbortController | undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || controller) return;
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]);
      void request<Result>(`${path}/simulate`, "POST", scenario, signal)
        .then((fresh) => {
          if (!signal.aborted) {
            setResult(fresh);
            setScenarioStatus("");
          }
        })
        .catch((error) => {
          if (!controller?.signal.aborted) {
            setScenarioStatus(
              "Forecast refresh failed. The last calculated plan is shown. " + errorText(error),
            );
          }
        })
        .finally(() => {
          controller = undefined;
        });
    }, 300_000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [path, scenario, busy]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const n = (key: string) => Number(values.get(key));
    const firstDate = String(values.get("canal_date") ?? "");
    const salinity = String(values.get("soil_ece") ?? "");
    const data: Settings = {
      taw_mm: n("taw"),
      initial_depletion_mm: n("depletion"),
      allowable_depletion: n("allowable"),
      efficiency: n("efficiency"),
      surface_taw_mm: n("surface_taw"),
      surface_raw_mm: n("surface_raw"),
      initial_surface_depletion_mm: n("surface_depletion"),
      soil_ece_ds_m: salinity === "" ? null : Number(salinity),
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
    setBusy(true);
    setSettingsStatus("");
    setResult(undefined);
    setScenario(undefined);
    try {
      const measurement = String(values.get("measured_at") ?? "");
      const query = measurement
        ? "?" + new URLSearchParams({ measured_at: new Date(measurement + "+05:00").toISOString() })
        : "";
      setSettings(await request<Settings>(`${path}/irrigation-settings${query}`, "PUT", data));
      setSettingsStatus("Irrigation settings saved.");
    } catch (error) {
      setSettingsStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const price = String(values.get("price"));
    const hours = String(values.get("pump_cap"));
    const input: Scenario = {
      rain_factor: Number(values.get("rain")),
      canal_delay_days: Number(values.get("delay")),
      pump_pkr_hour: price === "" ? null : Number(price),
      canal_supply_factor: Number(values.get("canal_fraction")) / 100,
      pump_available_from: String(values.get("pump_from")) || null,
      pump_hours_cap: hours === "" ? null : Number(hours),
    };
    setBusy(true);
    setResult(undefined);
    setScenario(undefined);
    setDecisionStatus("");
    setScenarioStatus("Running scenario…");
    try {
      setResult(await request<Result>(`${path}/simulate`, "POST", input));
      setScenario(input);
      setScenarioStatus("");
    } catch (error) {
      setScenarioStatus(errorText(error));
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
        title="Field inputs and water supply"
        subtitle="Use the field's measured water storage, current depletion and available supply."
      >
        {settings !== undefined && (
          <form onSubmit={save}>
            <div className="form-grid">
              <Numeric
                name="taw"
                label="Root-zone total available water (mm)"
                value={settings?.taw_mm}
                min={0.1}
                max={1200}
              />
              <Numeric
                name="depletion"
                label="Current root-zone depletion (mm)"
                value={settings?.initial_depletion_mm}
              />
              <Numeric
                name="allowable"
                label="Allowable depletion fraction"
                value={settings?.allowable_depletion ?? 0.5}
                min={0.01}
                max={0.99}
              />
              <Numeric
                name="efficiency"
                label="Application efficiency (fraction)"
                value={settings?.efficiency}
                min={0.01}
                max={1}
              />
              <Numeric
                name="surface_taw"
                label="Total evaporable surface water (mm)"
                value={settings?.surface_taw_mm ?? 20}
                min={0.1}
                max={80}
              />
              <Numeric
                name="surface_raw"
                label="Readily evaporable surface water (mm)"
                value={settings?.surface_raw_mm ?? 8}
              />
              <Numeric
                name="surface_depletion"
                label="Current surface depletion (mm)"
                value={settings?.initial_surface_depletion_mm}
              />
              <label>
                Soil-water measurement time (PKT)
                <input name="measured_at" type="datetime-local" />
                <small>
                  {settings?.measured_at
                    ? "Last recorded " + formatWeatherTime(settings.measured_at) + " PKT"
                    : "Record this when measuring depletion for automatic advisories."}
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
                {settings?.tubewell && (
                  <small>Saved pumping cost {show(settings.tubewell.pkr_hour)} PKR/hour</small>
                )}
              </fieldset>
            )}
            <Button type="submit" disabled={busy}>
              Save field inputs
            </Button>
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
            Retry loading field inputs
          </Button>
        )}
      </Card>
      <CropProgress key={path} path={path} />
      <CropLifecycle path={path} />
      <Card
        title="Irrigation scenarios"
        subtitle={`${field.crop} · ${field.stage} · Uses available forecast days`}
      >
        <p>
          Compare crop water balance and pumping cost using the forecast and field measurements.
        </p>
        <form className="form-grid" onSubmit={run}>
          <Numeric name="rain" label="Forecast rainfall multiplier" value={1} max={3} />
          <Numeric name="delay" label="Canal delay (days)" value={0} max={60} step={1} />
          <Numeric
            name="canal_fraction"
            label="Available canal allocation (%)"
            value={100}
            max={100}
          />
          <label>
            Tubewell available from
            <input name="pump_from" type="date" />
          </label>
          <Numeric name="pump_cap" label="Tubewell limit (hours/day)" max={24} required={false} />
          <Numeric name="price" label="Override pumping cost (PKR/hour)" required={false} />
          <Button type="submit" variant="primary" disabled={busy || !settings}>
            Run scenario
          </Button>
        </form>
        {scenarioStatus && <p role="status">{scenarioStatus}</p>}
      </Card>
      {result && (
        <Card
          title={`Recommended plan · ${result.recommended}`}
          subtitle={`${result.weather_source} forecast retrieved ${formatWeatherTime(result.weather_retrieved_at)} PKT · Readily available water ${show(result.readily_available_mm)} mm`}
        >
          {result.weather_fallback_reason && (
            <p>Weather fallback · {result.weather_fallback_reason}</p>
          )}
          {result.soil_inputs_source && (
            <p>
              {result.soil_inputs_source} ·{" "}
              {result.soil_measured_at
                ? `Measurement recorded ${formatWeatherTime(result.soil_measured_at)} PKT`
                : "Measurement time unrecorded"}
            </p>
          )}
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
            canReview={Boolean(
              scenario &&
              !scenarioStatus &&
              scenario.rain_factor === 1 &&
              scenario.canal_delay_days === 0 &&
              scenario.pump_pkr_hour == null &&
              scenario.canal_supply_factor === 1 &&
              scenario.pump_available_from == null &&
              scenario.pump_hours_cap == null,
            )}
            onDecision={decide}
          />
          {decisionStatus && <p role="status">{decisionStatus}</p>}
        </Card>
      )}
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
