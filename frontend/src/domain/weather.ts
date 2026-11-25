import { request } from "./registry";

const pakistanTime = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatWeatherTime(time: string) {
  const instant = new Date(time);
  return Number.isFinite(instant.getTime()) ? pakistanTime.format(instant) : "Unavailable";
}

export type DailyWeather = {
  date: string;
  max_c: number | null;
  min_c: number | null;
  rain_mm?: number | null;
  precipitation_mm?: number | null;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  dew_point_c?: number | null;
  cloud_pct?: number | null;
  visibility_km?: number | null;
  precip_probability_pct?: number | null;
  eto_mm?: number | null;
  wind_kmh?: number | null;
  gust_kmh?: number | null;
  uv_index?: number | null;
  solar_w_m2?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
  canal_capacity_m3?: number | null;
};

export type Observation = {
  time: string;
  temperature_c: number | null;
  feels_like_c: number | null;
  dew_point_c: number | null;
  humidity_pct: number | null;
  cloud_pct: number | null;
  visibility_km: number | null;
  pressure_hpa: number | null;
  precip_probability_pct: number | null;
  precip_rate_mmh: number | null;
  rain_rate_mmh: number | null;
  rain_mm: number | null;
  eto_mm: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  wind_direction_deg: number | null;
  uv_index: number | null;
};

export type AgricultureHour = {
  time: string;
  soil_temperature_c: number | null;
  soil_moisture_0_1_pct?: number | null;
  soil_moisture_1_3_pct?: number | null;
  soil_moisture_3_9_pct?: number | null;
  soil_moisture_9_27_pct?: number | null;
  soil_moisture_27_81_pct?: number | null;
  solar_w_m2: number | null;
  solar_direct_w_m2: number | null;
  solar_diffuse_w_m2: number | null;
};

export type WeatherSource = { source: string; retrieved_at: string };

export type WeatherHistory = WeatherSource & {
  daily: DailyWeather[];
  hourly: Observation[];
  modeled_history?: boolean;
};
export type AgricultureWeather = WeatherSource & {
  hourly: AgricultureHour[];
  soil_profile: "open-meteo";
};

export type FieldWeather = WeatherSource & {
  latitude: number;
  longitude: number;
  location_name?: string | null;
  timezone: string;
  daily: DailyWeather[];
  hourly: Observation[];
  interval_hours?: number;
  minutely?: Observation[];
};

export function fieldWeatherPath(fieldId: string) {
  return `/fields/${encodeURIComponent(fieldId)}/weather`;
}

export function loadForecast(fieldId: string) {
  return request<FieldWeather>(fieldWeatherPath(fieldId));
}
