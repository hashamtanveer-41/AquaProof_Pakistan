import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field, SelectField } from "@/domain/data";
import { request } from "@/domain/registry";
import { formatWeatherTime } from "@/domain/weather";
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
  canal: { first_date: string; cycle_days: number; hours: number; flow_m3_hour: number } | null;
  tubewell: { flow_m3_hour: number; hours_per_day: number; pkr_hour: number } | null;
};
type Scenario = { rain_factor: number; canal_delay_days: number; pump_pkr_hour: number | null };

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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [scenario, setScenario] = useState<Scenario>();
  const [decisionStatus, setDecisionStatus] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explanationStatus, setExplanationStatus] = useState("");
  const canal = field.source.toLowerCase().includes("canal");
  const tubewell = field.source.toLowerCase().includes("tubewell");
  useEffect(() => {
    let active = true;
    request<Settings | null>(`${path}/irrigation-settings`)
      .then((data) => {
        if (active) {
          setSettings(data);
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const n = (key: string) => Number(values.get(key));
    const firstDate = String(values.get("canal_date") ?? "");
    const data: Settings = {
      taw_mm: n("taw"),
      initial_depletion_mm: n("depletion"),
      allowable_depletion: n("allowable"),
      efficiency: n("efficiency"),
      surface_taw_mm: n("surface_taw"),
      surface_raw_mm: n("surface_raw"),
      initial_surface_depletion_mm: n("surface_depletion"),
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
            }
          : null,
    };
    setBusy(true);
    setSettingsStatus("");
    setResult(undefined);
    try {
      const measurement = String(values.get("measured_at") ?? "");
      const query = measurement
        ? "?" + new URLSearchParams({ measured_at: new Date(measurement).toISOString() })
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
    const input: Scenario = {
      rain_factor: Number(values.get("rain")),
      canal_delay_days: Number(values.get("delay")),
      pump_pkr_hour: price === "" ? null : Number(price),
    };
    setBusy(true);
    setResult(undefined);
    setExplanation("");
    setExplanationStatus("");
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
    setExplanation("");
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

  async function explain() {
    if (!scenario) return;
    setBusy(true);
    setResult(undefined);
    setExplanation("");
    setExplanationStatus("Generating explanation…");
    try {
      const data = await request<{ explanation: string; result: Result }>(
        `${path}/intelligence`,
        "POST",
        scenario,
      );
      setResult(data.result);
      setExplanation(data.explanation);
      setExplanationStatus("");
    } catch (error) {
      setExplanationStatus(errorText(error));
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
                Soil-water measurement time (local)
                <input name="measured_at" type="datetime-local" />
                <small>
                  {settings?.measured_at
                    ? "Last recorded " + formatWeatherTime(settings.measured_at) + " PKT"
                    : "Record this when measuring depletion for automatic advisories."}
                </small>
              </label>
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
                <Numeric
                  name="pump_price"
                  label="Running cost (PKR/hour)"
                  value={settings?.tubewell?.pkr_hour}
                  required={false}
                />
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
      <Card
        title="PI-Advisor irrigation planner"
        subtitle={`${field.crop} · ${field.stage} · Uses available forecast days`}
      >
        <p>
          Run the baseline with the values below, or vary rainfall, canal timing, and pumping cost
          to compare outcomes.
        </p>
        <form className="form-grid" onSubmit={run}>
          <Numeric name="rain" label="Forecast rainfall multiplier" value={1} max={3} />
          <Numeric name="delay" label="Canal delay (days)" value={0} max={60} step={1} />
          <Numeric name="price" label="Override pumping cost (PKR/hour)" required={false} />
          <Button type="submit" variant="primary" disabled={busy || !settings}>
            Run scenario
          </Button>
        </form>
        {scenarioStatus && <p role="status">{scenarioStatus}</p>}
        {explanationStatus && <p role="status">{explanationStatus}</p>}
      </Card>
      {result && (
        <Card
          title={`Recommended plan · ${result.recommended}`}
          subtitle={`${result.weather_source} forecast retrieved ${formatWeatherTime(result.weather_retrieved_at)} PKT · Readily available water ${show(result.readily_available_mm)} mm`}
        >
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
              scenario.rain_factor === 1 &&
              scenario.canal_delay_days === 0 &&
              scenario.pump_pkr_hour == null,
            )}
            onDecision={decide}
          />
          {decisionStatus && <p role="status">{decisionStatus}</p>}
          <Button onClick={() => void explain()} disabled={busy}>
            Explain this plan with AI
          </Button>
          {explanation && <p style={{ whiteSpace: "pre-wrap" }}>{explanation}</p>}
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
