"use client";

import { useState } from "react";
import { CloudRain, Droplets, Sun, Wind } from "lucide-react";
import { forecastDays, localWeather } from "@/domain/data";
import type { Field, Region, SelectField } from "@/domain/data";
import { GeoCanvas } from "@/features/map/GeoCanvas";
import { Card, Chip, Demo, LineChart, PageTitle, Stat } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";

export default function Weather({
  region,
  fields,
  field,
  open,
}: {
  region: Region;
  fields: Field[];
  field: Field;
  open: SelectField;
}) {
  const map = localWeather(field);
  const ownsCanal = field.source.includes("Canal");
  const [chart, setChart] = useState("temperature");
  const values =
    chart === "humidity"
      ? map.forecasts.map((v, i) => map.humidity + (map.temperature - v) * 2 + (i % 3))
      : chart === "rain"
        ? [0, 0, 0, Math.round(map.rain * 0.75), map.rain - Math.round(map.rain * 0.75), 0, 0]
        : map.forecasts;
  return (
    <>
      <PageTitle
        eyebrow="REGIONAL MONITORING"
        title="Weather & Canal Data"
        description={`Local forecast and water-supply observations for ${field.name} in ${map.district}.`}
      >
        <FieldSelect fields={fields} id={field.id} onChange={(id) => open(id)} />
      </PageTitle>
      <div className="stats-grid weather-stats">
        <Stat
          icon={<Sun size={20} />}
          tone="blue"
          label="Temperature"
          value={`${map.temperature}°C`}
          note="Forecast · synthetic"
        />
        <Stat
          icon={<Droplets size={20} />}
          tone="blue"
          label="Humidity"
          value={`${map.humidity}%`}
        />
        <Stat
          icon={<CloudRain size={20} />}
          tone="blue"
          label="7-day rainfall"
          value={
            <>
              {map.rain} <small>mm</small>
            </>
          }
        />
        <Stat
          icon={<Wind size={20} />}
          tone="blue"
          label="Wind"
          value={
            <>
              {map.wind} <small>km/h</small>
            </>
          }
        />
      </div>
      <div className="grid-2">
        <Card
          className="embedded-map"
          title="Local weather map"
          subtitle={`${map.district} · reference station`}
          action={<Demo />}
        >
          <GeoCanvas
            key={region}
            region={region}
            fields={fields.filter((f) => f.region === region)}
            selected={field.id}
            onSelect={(id) => open(id)}
            weather
          />
        </Card>
        <Card
          title="Seven-day forecast"
          subtitle="20–26 March 2026 · synthetic forecast"
          action={
            <select
              value={chart}
              aria-label="Weather chart metric"
              onChange={(e) => setChart(e.target.value)}
            >
              <option value="temperature">Temperature</option>
              <option value="humidity">Humidity</option>
              <option value="rain">Rainfall</option>
            </select>
          }
        >
          <LineChart
            data={values}
            labels={forecastDays}
            unit={chart === "humidity" ? "%" : chart === "rain" ? " mm" : "°"}
            color="#347bb2"
          />
          <div className="notice">
            <CloudRain size={18} />
            <span>
              Demo alert:{" "}
              {map.rain > 8
                ? "Rain expected around 23 March. Review the proposed irrigation date."
                : "Light showers are modeled for 23 March. Confirm conditions before irrigating."}
            </span>
          </div>
        </Card>
      </div>
      <Card
        title="Water supply and irrigation schedule"
        subtitle="Synthetic schedules are not official allocations."
        action={<Demo />}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Value</th>
                <th>Source / verification</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Next canal turn</td>
                <td>{ownsCanal ? `${map.canalDay} · ${map.canal}` : "No canal allocation"}</td>
                <td>
                  <Chip tone="amber">Synthetic · not verified</Chip>
                </td>
              </tr>
              <tr>
                <td>Verified canal allocations</td>
                <td>Not available in this prototype</td>
                <td>
                  <Chip tone="neutral">Official feed not connected</Chip>
                </td>
              </tr>
              <tr>
                <td>Reference canal discharge</td>
                <td>{map.flow}</td>
                <td>
                  <Chip tone="neutral">Demo observation</Chip>
                </td>
              </tr>
              <tr>
                <td>Last recorded irrigation</td>
                <td>
                  {[...field.history]
                    .reverse()
                    .find((h) => h.label.toLowerCase().includes("irrigation"))?.date ??
                    "Not recorded"}
                </td>
                <td>
                  <Chip tone="blue">Farmer reported · demo</Chip>
                </td>
              </tr>
              <tr>
                <td>Planned irrigation</td>
                <td>{ownsCanal ? `${map.canalDay} · pending officer review` : "Not scheduled"}</td>
                <td>
                  <Chip tone="neutral">Scenario, not an allocation</Chip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
