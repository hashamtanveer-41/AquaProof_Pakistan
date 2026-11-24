import { request } from "./registry";

export type DailyWeather = {
  date: string;
  max_c: number | null;
  min_c: number | null;
  rain_mm: number | null;
  eto_mm?: number | null;
  solar_mj_m2?: number | null;
  canal_capacity_m3?: number | null;
};

export type FieldWeather = {
  source: string;
  latitude: number;
  longitude: number;
  daily: DailyWeather[];
};

export function loadForecast(fieldId: string) {
  return request<FieldWeather>(`/fields/${encodeURIComponent(fieldId)}/weather`);
}
