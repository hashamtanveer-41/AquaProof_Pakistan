import { useEffect, useState } from "react";
import { Layers, MapPin, Ruler, Sprout, Users } from "lucide-react";
import { Button, Card, Empty, PageTitle, Stat, TextAction } from "@/components/ui";
import { FieldSelect } from "@/components/FieldSelect";
import {
  acres,
  type Farmer,
  type Field,
  type Page,
  type Region,
  type SelectField,
} from "@/domain/data";
import { formatWeatherTime, loadForecast, type FieldWeather } from "@/domain/weather";
import { GeoCanvas } from "@/features/map/GeoCanvas";

function ForecastSummary({ field }: { field: Field }) {
  const [forecast, setForecast] = useState<FieldWeather>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadForecast(field.id)
      .then((data) => {
        if (active) setForecast(data);
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "The forecast is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [field.id, attempt]);

  const refresh = () => {
    setForecast(undefined);
    setError("");
    setAttempt((current) => current + 1);
  };

  if (error)
    return (
      <>
        <p role="status">{error}</p>
        <TextAction onClick={refresh}>Retry forecast</TextAction>
      </>
    );
  if (!forecast) return <p role="status">Loading field forecast…</p>;

  return (
    <>
      <div className="weather-source">
        <p>
          {forecast.source} · Retrieved {formatWeatherTime(forecast.retrieved_at)} PKT
        </p>
        <Button onClick={refresh}>Refresh forecast</Button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>High (°C)</th>
              <th>Rain (mm)</th>
              <th>Reference ET (mm)</th>
            </tr>
          </thead>
          <tbody>
            {forecast.daily.slice(0, 3).map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.max_c ?? "Unavailable"}</td>
                <td>{day.rain_mm ?? "Unavailable"}</td>
                <td>{day.eto_mm ?? "Unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function LiveOverview({
  region,
  fields,
  farmers,
  field,
  open,
  go,
}: {
  region: Region;
  fields: Field[];
  farmers: Farmer[];
  field?: Field;
  open: SelectField;
  go: (page: Page) => void;
}) {
  const totalArea = fields.reduce((sum, item) => sum + item.acres, 0);
  const cropArea = new Map<string, number>();
  for (const item of fields) {
    cropArea.set(item.crop, (cropArea.get(item.crop) ?? 0) + item.acres);
  }
  const crops = [...cropArea].sort((left, right) => right[1] - left[1]);
  const needsPlanting = fields.filter((item) => item.planted === "Not recorded").length;

  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS OVERVIEW"
        title="Overview Dashboard"
        description={
          region
            ? `Registered fields and local conditions in ${region}.`
            : "Registered fields and local conditions across all locations."
        }
      >
        <Button variant="primary" onClick={() => go("map")}>
          <MapPin size={16} /> Open Farm Map
        </Button>
      </PageTitle>
      <div className="stats-grid weather-stats">
        <Stat icon={<Users size={20} />} label="Registered farmers" value={farmers.length} />
        <Stat icon={<Layers size={20} />} label="Mapped fields" value={fields.length} />
        <Stat icon={<Ruler size={20} />} label="Mapped area" value={`${acres(totalArea)} ac`} />
        <Stat
          icon={<Sprout size={20} />}
          label="Fields missing a planting date"
          value={needsPlanting}
        />
      </div>
      {!field ? (
        <Card title="Registered fields">
          <Empty
            title={region ? "No mapped fields in this region" : "No mapped fields yet"}
            text="Draw a boundary in Farm Map to see field records and local weather here."
            action={<Button onClick={() => go("map")}>Go to Farm Map</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid-2 wide-left">
            <Card
              className="embedded-map"
              title="Registered field map"
              subtitle={region || "All locations"}
              action={
                <TextAction onClick={() => open(field.id, "map")}>View on Farm Map</TextAction>
              }
            >
              <GeoCanvas fields={fields} selected={field.id} onSelect={open} />
            </Card>
            <Card title="Crops by mapped area">
              <div className="crop-bars">
                {crops.map(([crop, area]) => (
                  <div key={crop}>
                    <div>
                      <strong>{crop}</strong>
                      <span>{acres(area)} ac</span>
                    </div>
                    <progress aria-label={crop} value={area} max={totalArea || 1} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <Card
            title="Field weather"
            subtitle={field.name}
            action={<FieldSelect fields={fields} id={field.id} onChange={open} />}
          >
            <ForecastSummary key={field.id} field={field} />
            <TextAction onClick={() => open(field.id, "weather")}>
              Open full forecast and history
            </TextAction>
          </Card>
          <Card title="Field records">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Region</th>
                    <th>Crop</th>
                    <th>Crop stage</th>
                    <th>Acres</th>
                    <th>Weather</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <TextAction onClick={() => open(item.id, "profile")}>
                          {item.name}
                        </TextAction>
                      </td>
                      <td>{item.region}</td>
                      <td>{item.crop}</td>
                      <td>{item.stage}</td>
                      <td>{acres(item.acres)}</td>
                      <td>
                        <TextAction onClick={() => open(item.id, "weather")}>
                          View forecast
                        </TextAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
