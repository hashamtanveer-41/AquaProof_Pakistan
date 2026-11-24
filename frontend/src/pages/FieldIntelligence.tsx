import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field, SelectField } from "@/domain/data";
import { request } from "@/domain/registry";
import { loadForecast, type FieldWeather as Weather } from "@/domain/weather";
type Settings = {
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
type Plan = {
  cost_pkr: number;
  stress_score: number;
  daily: {
    date: string;
    stage: string;
    crop_et_mm: number;
    rain_mm: number;
    canal_m3: number;
    pump_m3: number;
    depletion_mm: number;
    stress_mm: number;
    unmet_et_mm: number;
  }[];
};
type Result = {
  recommended: string;
  plans: Record<string, Plan>;
  readily_available_mm: number;
  crop: string;
};
type Scenario = { rain_factor: number; canal_delay_days: number; pump_pkr_hour: number | null };

const show = (value?: number | null) =>
  value == null ? "Unavailable" : value.toLocaleString("en-PK", { maximumFractionDigits: 2 });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";

function WeatherTable({ weather, historical = false }: { weather: Weather; historical?: boolean }) {
  if (!weather.daily.length) return <p>No published observations were returned for those dates.</p>;
  return (
    <>
      <p>
        {weather.source} for {weather.latitude.toFixed(4)}°, {weather.longitude.toFixed(4)}°
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Low (°C)</th>
              <th>High (°C)</th>
              <th>Rain (mm)</th>
              {historical ? (
                <th>Solar (MJ/m²/day)</th>
              ) : (
                <>
                  <th>Reference ET (mm)</th>
                  <th>Canal turn (m³)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {weather.daily.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{show(day.min_c)}</td>
                <td>{show(day.max_c)}</td>
                <td>{show(day.rain_mm)}</td>
                {historical ? (
                  <td>{show(day.solar_mj_m2)}</td>
                ) : (
                  <>
                    <td>{show(day.eto_mm)}</td>
                    <td>
                      {day.canal_capacity_m3 == null ? "Unconfigured" : show(day.canal_capacity_m3)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FieldWeather({ path, fieldId }: { path: string; fieldId: string }) {
  const [forecast, setForecast] = useState<Weather>();
  const [history, setHistory] = useState<Weather>();
  const [forecastStatus, setForecastStatus] = useState("Loading forecast…");
  const [historyStatus, setHistoryStatus] = useState("Loading history…");
  useEffect(() => {
    let active = true;
    loadForecast(fieldId)
      .then((data) => {
        if (active) {
          setForecast(data);
          setForecastStatus("");
        }
      })
      .catch((error) => {
        if (active) setForecastStatus(errorText(error));
      });
    request<Weather>(`${path}/weather/history`)
      .then((data) => {
        if (active) {
          setHistory(data);
          setHistoryStatus("");
        }
      })
      .catch((error) => {
        if (active) setHistoryStatus(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [path, fieldId]);

  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setHistoryStatus("Loading history…");
    setHistory(undefined);
    try {
      const range = new URLSearchParams({
        start: String(values.get("start")),
        end: String(values.get("end")),
      });
      setHistory(await request<Weather>(`${path}/weather/history?${range}`));
      setHistoryStatus("");
    } catch (error) {
      setHistoryStatus(errorText(error));
    }
  }

  return (
    <>
      <Card title="Seven-day forecast">
        {forecast ? <WeatherTable weather={forecast} /> : <p role="status">{forecastStatus}</p>}
      </Card>
      <Card title="Historical weather">
        <form className="form-grid" onSubmit={loadHistory}>
          <label>
            Start date
            <input name="start" type="date" required />
          </label>
          <label>
            End date
            <input name="end" type="date" required />
          </label>
          <Button type="submit" disabled={historyStatus === "Loading history…"}>
            Load dates
          </Button>
        </form>
        {history ? (
          <WeatherTable weather={history} historical />
        ) : (
          <p role="status">{historyStatus}</p>
        )}
      </Card>
    </>
  );
}

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
  const [scenarioStatus, setScenarioStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [scenario, setScenario] = useState<Scenario>();
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
      });
    return () => {
      active = false;
    };
  }, [path]);

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
      setSettings(await request<Settings>(`${path}/irrigation-settings`, "PUT", data));
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

  async function explain() {
    if (!scenario) return;
    setBusy(true);
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
      </Card>
      <Card title="What-if scenario" subtitle={`${field.crop} · ${field.stage}`}>
        <form className="form-grid" onSubmit={run}>
          <Numeric name="rain" label="Forecast rainfall multiplier" value={1} max={3} />
          <Numeric name="delay" label="Canal delay (days)" value={0} max={60} step={1} />
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
          subtitle={`Readily available water: ${show(result.readily_available_mm)} mm`}
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Crop stage</th>
                  <th>Crop ET (mm)</th>
                  <th>Rain (mm)</th>
                  <th>Canal (m³)</th>
                  <th>Tubewell (m³)</th>
                  <th>Depletion (mm)</th>
                  <th>Unmet ET (mm)</th>
                </tr>
              </thead>
              <tbody>
                {result.plans[result.recommended].daily.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.stage}</td>
                    <td>{show(day.crop_et_mm)}</td>
                    <td>{show(day.rain_mm)}</td>
                    <td>{show(day.canal_m3)}</td>
                    <td>{show(day.pump_m3)}</td>
                    <td>{show(day.depletion_mm)}</td>
                    <td>{show(day.unmet_et_mm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={() => void explain()} disabled={busy}>
            Explain this plan with AI
          </Button>
          {explanationStatus && <p role="status">{explanationStatus}</p>}
          {explanation && <p style={{ whiteSpace: "pre-wrap" }}>{explanation}</p>}
        </Card>
      )}
    </>
  );
}

export default function FieldIntelligence({
  mode,
  field,
  fields,
  open,
}: {
  mode: "weather" | "irrigation";
  field?: Field;
  fields: Field[];
  open: SelectField;
}) {
  const path = `/fields/${encodeURIComponent(field?.id ?? "")}`;
  return (
    <>
      <PageTitle
        eyebrow="FIELD INTELLIGENCE"
        title={mode === "weather" ? "Weather & Canal Data" : "Irrigation Intelligence"}
        description={
          field
            ? `Field-level data for ${field.name}.`
            : "Register a field to use its location and crop records."
        }
      >
        {field && <FieldSelect fields={fields} id={field.id} onChange={open} />}
      </PageTitle>
      {field ? (
        mode === "weather" ? (
          <FieldWeather key={path} path={path} fieldId={field.id} />
        ) : (
          <FieldIrrigation key={path} path={path} field={field} />
        )
      ) : (
        <Empty
          title="No registered field selected"
          text="Go to the Farm Map to draw and register a field."
        />
      )}
    </>
  );
}
