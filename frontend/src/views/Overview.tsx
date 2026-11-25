"use client";

import { CloudRain, Droplets, History, MapPin, Sprout, Users, Wallet } from "lucide-react";
import { acres, forecastDays, pkr, regionData } from "@/domain/data";
import type { Farmer, Field, Page, Region, SelectField } from "@/domain/data";
import { GeoCanvas } from "@/features/map/GeoCanvas";
import { Button, Card, Demo, LineChart, PageTitle, Stat, TextAction } from "@/components/ui";

export default function Overview({
  region,
  fields,
  farmers,
  open,
  go,
  pending,
}: {
  region: Region;
  fields: Field[];
  farmers: Farmer[];
  open: SelectField;
  go: (page: Page) => void;
  pending: number;
}) {
  const map = regionData[region];
  const farms = fields.filter((f) => f.region === region);
  const owners = farmers.filter((f) => f.region === region);
  const data = Object.entries(
    farms.reduce<Record<string, number>>(
      (all, f) => ({ ...all, [f.crop]: (all[f.crop] ?? 0) + f.acres }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1]);
  const total = data.reduce((sum, item) => sum + item[1], 0);
  const attention = farms.filter((f) => f.source.includes("Tubewell"));
  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS OVERVIEW"
        title="Overview Dashboard"
        description={`Agricultural operations and irrigation priorities across ${map.district}.`}
      >
        <Demo>Demo dataset · 20 Mar 2026</Demo>
        <Button variant="primary" onClick={() => go("map")}>
          <MapPin size={16} /> Open Farm Map
        </Button>
      </PageTitle>
      <div className="stats-grid overview-stats">
        <Stat icon={<Users size={20} />} label="Registered farmers" value={owners.length} />
        <Stat
          icon={<MapPin size={20} />}
          label="Mapped agricultural area"
          value={
            <>
              {acres(total)} <small>ac</small>
            </>
          }
        />
        <Stat icon={<Sprout size={20} />} label="Active crops" value={data.length} />
        <Stat
          icon={<Droplets size={20} />}
          tone="amber"
          label="Irrigation review"
          value={attention.length}
        />
        <Stat
          icon={<Wallet size={20} />}
          label="Modeled pumping cost"
          value={pkr(attention.reduce((sum, f) => sum + f.rate * 2, 0))}
        />
        <Stat icon={<History size={20} />} label="Advisories pending" value={pending} />
      </div>
      <div className="grid-2 wide-left">
        <Card
          className="embedded-map"
          title="Registered fields"
          subtitle={`${map.district}, ${map.short}`}
          action={<TextAction onClick={() => go("map")}>Open map</TextAction>}
        >
          <GeoCanvas
            key={region}
            region={region}
            fields={farms}
            onSelect={(id) => open(id, "profile")}
            selected={farms[0]?.id}
          />
        </Card>
        <Card title="Crop distribution" subtitle="Share of mapped area">
          <div className="crop-bars">
            {data.map(([crop, value], i) => (
              <div key={crop}>
                <div>
                  <strong>{crop}</strong>
                  <span>{acres(value)} ac</span>
                </div>
                <progress
                  value={value}
                  max={total}
                  style={{ accentColor: ["#168556", "#60a77d", "#98b965", "#c8ad68"][i % 4] }}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid-2">
        <Card
          title="Modeled water requirement"
          subtitle="District reference demand · illustrative millimeters"
        >
          <LineChart
            data={map.moisture.map((v) => Math.round(v / 12))}
            labels={forecastDays}
            unit=" mm"
          />
        </Card>
        <Card
          title="Regional conditions"
          subtitle="Synthetic maximum temperatures and irrigation activity"
        >
          <LineChart
            data={map.forecasts}
            secondary={map.moisture.map((v, i) => (i % 3 ? Math.round(v / 4) : 0))}
            labels={forecastDays}
          />
          <div className="chart-legend">
            <span>
              <i /> Temperature °C
            </span>
            <span>
              <i className="amber" /> Modeled irrigation activity (mm)
            </span>
          </div>
        </Card>
      </div>
      <Card title="Officer attention queue" subtitle="Prioritized requests and local conditions">
        <div className="list-rows">
          <div>
            <span className="mini-icon blue">
              <CloudRain size={17} />
            </span>
            <div>
              <strong>{map.rain} mm rainfall in the regional demo forecast</strong>
              <p>Weather alert · {map.district}</p>
            </div>
            <TextAction onClick={() => go("weather")}>Review weather</TextAction>
          </div>
          {attention.map((f) => (
            <div key={f.id}>
              <span className="mini-icon amber">
                <Droplets size={17} />
              </span>
              <div>
                <strong>{f.name}</strong>
                <p>{f.crop} · Compare canal timing with pumping cost</p>
              </div>
              <TextAction onClick={() => open(f.id, "irrigation")}>Review field</TextAction>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
