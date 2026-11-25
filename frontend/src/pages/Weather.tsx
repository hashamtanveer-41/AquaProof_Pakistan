import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import type { Field, SelectField } from "@/domain/data";
import { request } from "@/domain/registry";
import {
  fieldWeatherPath,
  formatWeatherTime,
  type AgricultureHour,
  type AgricultureWeather,
  type DailyWeather,
  type FieldWeather,
  type Observation,
  type WeatherHistory,
  type WeatherSource,
} from "@/domain/weather";

const timeOfDay = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  hour: "numeric",
  minute: "2-digit",
});
const number = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 });
const show = (value: number | null | undefined) =>
  value == null ? "Unavailable" : number.format(value);

type Metric<T> = [keyof T, string];

const dailyMetrics: Metric<DailyWeather>[] = [
  ["min_c", "Low (°C)"],
  ["max_c", "High (°C)"],
  ["rain_mm", "Rain (mm)"],
  ["precip_probability_pct", "Peak precip. chance (%)"],
  ["eto_mm", "Reference ET (mm)"],
  ["humidity_pct", "Mean humidity (%)"],
  ["wind_kmh", "Peak wind (km/h)"],
  ["gust_kmh", "Peak gust (km/h)"],
  ["cloud_pct", "Mean cloud cover (%)"],
  ["uv_index", "Peak UV index"],
];
const archiveMetrics: Metric<DailyWeather>[] = [
  ["min_c", "Low (°C)"],
  ["max_c", "High (°C)"],
  ["precipitation_mm", "Total precipitation (mm)"],
  ["humidity_pct", "Mean humidity (%)"],
  ["wind_kmh", "Mean wind (km/h)"],
  ["dew_point_c", "Mean dew point (°C)"],
  ["cloud_pct", "Mean cloud cover (%)"],
  ["solar_w_m2", "Mean solar irradiance (W/m²)"],
];
const hourlyMetrics: Metric<Observation>[] = [
  ["temperature_c", "Temperature (°C)"],
  ["feels_like_c", "Feels like (°C)"],
  ["rain_mm", "Rain (mm)"],
  ["precip_probability_pct", "Precip. chance (%)"],
  ["precip_rate_mmh", "Precip. intensity (mm/h)"],
  ["humidity_pct", "Humidity (%)"],
  ["wind_kmh", "Wind (km/h)"],
  ["gust_kmh", "Gust (km/h)"],
  ["wind_direction_deg", "Wind direction (°)"],
  ["eto_mm", "Reference ET (mm)"],
  ["dew_point_c", "Dew point (°C)"],
  ["cloud_pct", "Cloud cover (%)"],
  ["visibility_km", "Visibility (km)"],
  ["pressure_hpa", "Pressure (hPa)"],
  ["uv_index", "UV index"],
];
const currentMetrics: Metric<Observation>[] = [
  ["temperature_c", "Temperature (°C)"],
  ["feels_like_c", "Feels like (°C)"],
  ["rain_rate_mmh", "Rain rate (mm/h)"],
  ["precip_rate_mmh", "Precip. intensity (mm/h)"],
  ["humidity_pct", "Humidity (%)"],
  ["wind_kmh", "Wind (km/h)"],
  ["gust_kmh", "Gust (km/h)"],
  ["wind_direction_deg", "Wind direction (°)"],
  ["dew_point_c", "Dew point (°C)"],
  ["cloud_pct", "Cloud cover (%)"],
  ["visibility_km", "Visibility (km)"],
  ["pressure_hpa", "Pressure (hPa)"],
  ["uv_index", "UV index"],
];
const openMeteoSoil: Metric<AgricultureHour>[] = [
  ["soil_temperature_c", "Surface soil temperature (°C)"],
  ["soil_moisture_0_1_pct", "Soil moisture, 0–1 cm (%)"],
  ["soil_moisture_1_3_pct", "Soil moisture, 1–3 cm (%)"],
  ["soil_moisture_3_9_pct", "Soil moisture, 3–9 cm (%)"],
  ["soil_moisture_9_27_pct", "Soil moisture, 9–27 cm (%)"],
  ["soil_moisture_27_81_pct", "Soil moisture, 27–81 cm (%)"],
];
const solarMetrics: Metric<AgricultureHour>[] = [
  ["solar_w_m2", "Global irradiance (W/m²)"],
  ["solar_direct_w_m2", "Direct irradiance (W/m²)"],
  ["solar_diffuse_w_m2", "Diffuse irradiance (W/m²)"],
];

function WeatherRequest<T extends WeatherSource>({
  path,
  children,
}: {
  path: string;
  children: (data: T) => ReactNode;
}) {
  const [result, setResult] = useState<{ data: T } | { error: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<T>(path)
      .then((data) => {
        if (active) setResult({ data });
      })
      .catch((error) => {
        if (active)
          setResult({ error: error instanceof Error ? error.message : "Weather is unavailable." });
      });
    return () => {
      active = false;
    };
  }, [path, attempt]);

  const refresh = () => {
    setResult(undefined);
    setAttempt((current) => current + 1);
  };
  if (!result) return <p role="status">Loading weather…</p>;
  if ("data" in result)
    return (
      <>
        <div className="weather-source">
          <span>
            {result.data.source} · Retrieved {formatWeatherTime(result.data.retrieved_at)} PKT
          </span>
          <Button onClick={refresh}>Refresh weather</Button>
        </div>
        {children(result.data)}
      </>
    );
  return (
    <>
      <p role="status">{result.error}</p>
      <Button onClick={refresh}>Retry</Button>
    </>
  );
}

type Column<T> = [string, (row: T) => ReactNode];

function metricColumns<T>(metrics: Metric<T>[]): Column<T>[] {
  return metrics.map(([key, label]) => [
    label,
    (row) => (typeof row[key] === "number" ? show(row[key]) : "Unavailable"),
  ]);
}

function WeatherTable<T>({
  rows,
  columns,
  rowKey,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
}) {
  if (!rows.length) return <p>No data returned for this period.</p>;
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table>
        <thead>
          <tr>
            {columns.map(([heading]) => (
              <th scope="col" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map(([heading, value]) => (
                <td key={heading}>{value(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyForecast({
  data,
  name,
  showCanal,
}: {
  data: FieldWeather;
  name: string;
  showCanal: boolean;
}) {
  const columns: Column<DailyWeather>[] = [
    ["Date", (row) => row.date],
    ...metricColumns(dailyMetrics.filter(([key]) => data.daily.some((row) => row[key] != null))),
  ];
  if (!data.interval_hours) {
    columns.push(
      ["Sunrise", (row) => (row.sunrise ? timeOfDay.format(new Date(row.sunrise)) : "Unavailable")],
      ["Sunset", (row) => (row.sunset ? timeOfDay.format(new Date(row.sunset)) : "Unavailable")],
    );
  }
  if (showCanal)
    columns.splice(6, 0, [
      "Canal turn (m³)",
      (row) => (row.canal_capacity_m3 == null ? "Unconfigured" : show(row.canal_capacity_m3)),
    ]);
  return (
    <Card
      title={data.interval_hours === 3 ? "Forecast by date" : "Daily forecast"}
      subtitle={`${name} · ${data.latitude.toFixed(4)}°, ${data.longitude.toFixed(4)}° · ${data.daily.length} days (${data.timezone})`}
    >
      {data.interval_hours === 3 && (
        <p>
          OpenWeather groups the available three-hour periods by their end time in Pakistan. The
          first and last dates may be partial. Irrigation uses Open-Meteo daily rainfall and
          reference ET.
        </p>
      )}
      <WeatherTable
        rows={data.daily}
        columns={columns}
        rowKey={(row) => row.date}
        label="Daily forecast metrics"
      />
    </Card>
  );
}

function Hours<T extends { time: string }>({
  rows,
  metrics,
  label,
}: {
  rows: T[];
  metrics: Metric<T>[];
  label: string;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 24;
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  const columns: Column<T>[] = [
    ["Time (PKT)", (row) => formatWeatherTime(row.time)],
    ...metricColumns(metrics),
  ];
  return (
    <>
      {rows.length > pageSize && (
        <div className="filters">
          <select
            aria-label={label + " period"}
            value={page}
            onChange={(event) => setPage(Number(event.target.value))}
          >
            {Array.from({ length: Math.ceil(rows.length / pageSize) }, (_, index) => (
              <option key={index} value={index}>
                {formatWeatherTime(rows[index * pageSize].time)}
                {" – "}
                {formatWeatherTime(rows[Math.min((index + 1) * pageSize, rows.length) - 1].time)}
              </option>
            ))}
          </select>
        </div>
      )}
      <WeatherTable rows={visible} columns={columns} rowKey={(row) => row.time} label={label} />
    </>
  );
}

function CurrentConditions({ path }: { path: string }) {
  return (
    <Card title="Current conditions" subtitle="Pakistan Standard Time">
      <WeatherRequest<Observation & WeatherSource> key={path} path={path}>
        {(data) => (
          <dl className="weather-readings">
            <div>
              <dt>Conditions at</dt>
              <dd>{formatWeatherTime(data.time)}</dd>
            </div>
            {currentMetrics.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{typeof data[key] === "number" ? show(data[key]) : "Unavailable"}</dd>
              </div>
            ))}
          </dl>
        )}
      </WeatherRequest>
    </Card>
  );
}

function FieldHistory({ path }: { path: string }) {
  const [recent, setRecent] = useState(false);
  const [archivePath, setArchivePath] = useState("");
  const [archiveAttempt, setArchiveAttempt] = useState(0);
  return (
    <>
      <Card title="Recent weather history" subtitle="Hourly weather for the last 24 hours.">
        {recent ? (
          <WeatherRequest<WeatherHistory> path={path + "/recent"}>
            {(history) => (
              <div className="stack">
                {history.modeled_history && <p>Open-Meteo recent values are modeled estimates.</p>}
                {history.daily.length > 0 && (
                  <WeatherTable
                    rows={history.daily}
                    columns={[["Date (PKT)", (row) => row.date], ...metricColumns(dailyMetrics)]}
                    rowKey={(row) => row.date}
                    label="Recent daily history"
                  />
                )}
                <Hours
                  rows={history.hourly}
                  metrics={hourlyMetrics}
                  label="Recent hourly history"
                />
              </div>
            )}
          </WeatherRequest>
        ) : (
          <Button onClick={() => setRecent(true)}>Load recent history</Button>
        )}
      </Card>
      <Card
        title="Historical archive"
        subtitle="Search up to 31 days from 2000 through seven days ago."
      >
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const range = new URLSearchParams({
              start: String(values.get("start")),
              end: String(values.get("end")),
            });
            setArchivePath(path + "/history?" + range);
            setArchiveAttempt((attempt) => attempt + 1);
          }}
        >
          <label>
            Start date (UTC)
            <input name="start" type="date" min="2000-01-01" required />
          </label>
          <label>
            End date (UTC)
            <input name="end" type="date" min="2000-01-01" required />
          </label>
          <Button type="submit">Load dates</Button>
        </form>
        {archivePath && (
          <WeatherRequest<Pick<FieldWeather, keyof WeatherSource | "daily" | "timezone">>
            key={archivePath + archiveAttempt}
            path={archivePath}
          >
            {(history) => (
              <WeatherTable
                rows={history.daily}
                columns={[
                  [`Date (${history.timezone})`, (row) => row.date],
                  ...metricColumns(archiveMetrics),
                ]}
                rowKey={(row) => row.date}
                label="Historical archive metrics"
              />
            )}
          </WeatherRequest>
        )}
      </Card>
    </>
  );
}

function FieldAgriculture({ path }: { path: string }) {
  const [requested, setRequested] = useState(false);
  return (
    <Card
      title="Soil and solar outlook"
      subtitle="Hourly soil moisture, soil temperature, and solar irradiance for the next 24 hours where available. Soil values are modeled estimates."
    >
      {requested ? (
        <WeatherRequest<AgricultureWeather> path={path + "/agriculture"}>
          {(data) => (
            <Hours
              rows={data.hourly}
              metrics={[...openMeteoSoil, ...solarMetrics]}
              label="Soil and solar outlook"
            />
          )}
        </WeatherRequest>
      ) : (
        <Button onClick={() => setRequested(true)}>Load soil and solar data</Button>
      )}
    </Card>
  );
}

export default function Weather({
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
  const [search, setSearch] = useState("");
  const [searchAttempt, setSearchAttempt] = useState(0);
  const fieldPath = field ? fieldWeatherPath(field.id) : "";
  const forecastPath = search ? "/weather/search?" + new URLSearchParams({ q: search }) : fieldPath;

  return (
    <>
      <PageTitle
        eyebrow="FIELD INTELLIGENCE"
        title="Weather & Canal Data"
        description="Current conditions and forecasts for registered fields or a location you search."
      >
        {field && (
          <FieldSelect
            fields={fields}
            id={field.id}
            onChange={(id) => {
              setSearch("");
              open(id);
            }}
          />
        )}
      </PageTitle>
      <Card title="Search weather by location">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const query = String(new FormData(event.currentTarget).get("location")).trim();
            if (query.length >= 2) {
              setSearch(query);
              setSearchAttempt((attempt) => attempt + 1);
            }
          }}
        >
          <label className="full-line">
            Place name or latitude, longitude
            <input
              name="location"
              placeholder="e.g. Lahore, Pakistan or 31.52, 74.36"
              minLength={2}
              maxLength={120}
              required
            />
          </label>
          <Button variant="primary" type="submit">
            Search weather
          </Button>
        </form>
        {search && field && <Button onClick={() => setSearch("")}>Back to field weather</Button>}
      </Card>
      {fieldPath && !search && <CurrentConditions path={fieldPath + "/current"} />}
      {forecastPath ? (
        <WeatherRequest<FieldWeather> key={forecastPath + searchAttempt} path={forecastPath}>
          {(data) => (
            <>
              {search && (
                <CurrentConditions
                  path={
                    "/weather/current?" +
                    new URLSearchParams({
                      latitude: String(data.latitude),
                      longitude: String(data.longitude),
                    })
                  }
                />
              )}
              <DailyForecast
                data={data}
                name={search ? data.location_name || search : field?.name || ""}
                showCanal={!search}
              />
              <Card
                title={data.interval_hours === 3 ? "Three-hour forecast" : "Hourly forecast"}
                subtitle="Pakistan Standard Time"
              >
                <Hours
                  rows={data.hourly}
                  metrics={hourlyMetrics.filter(([key]) =>
                    data.hourly.some((row) => row[key] != null),
                  )}
                  label={data.interval_hours === 3 ? "Three-hour forecast" : "Hourly forecast"}
                />
              </Card>
              {data.minutely && data.minutely.length > 0 && (
                <Card title="Minute-by-minute forecast" subtitle="Pakistan Standard Time">
                  <Hours
                    rows={data.minutely}
                    metrics={hourlyMetrics}
                    label="Minute-by-minute forecast"
                  />
                </Card>
              )}
            </>
          )}
        </WeatherRequest>
      ) : (
        <Empty
          title="No registered field selected"
          text="Search for a location above, or register a field to see its forecast and canal schedule."
          action={<Button onClick={openMap}>Open Farm Map</Button>}
        />
      )}
      {fieldPath && !search && (
        <>
          <FieldAgriculture key={fieldPath + "/agriculture"} path={fieldPath} />
          <FieldHistory key={fieldPath + "/history"} path={fieldPath} />
        </>
      )}
    </>
  );
}
