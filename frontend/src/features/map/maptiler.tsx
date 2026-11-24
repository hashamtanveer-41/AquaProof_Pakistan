import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Point } from "@/domain/data";
import { request } from "@/domain/registry";

const host = "https://api.maptiler.com";
export const mapStyles = {
  satellite: { label: "Satellite", id: "satellite-v4" },
  hybrid: { label: "Hybrid", id: "hybrid-v4" },
  streets: { label: "Streets", id: "streets-v4" },
} as const;
export type Basemap = keyof typeof mapStyles;

type MapConfig = { api_key: string; tracing_authorized: boolean };
const Config = createContext<{ config?: MapConfig; error: string; retry: () => void }>({
  error: "",
  retry: () => {},
});

export function MapProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MapConfig>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<MapConfig>("/map/config")
      .then((data) => {
        if (!active) return;
        setConfig(data);
        if (!data.api_key)
          setError("MapTiler is unavailable until its key is configured on the server.");
      })
      .catch(() => {
        if (active) setError("Map configuration could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setConfig(undefined);
    setError("");
    setAttempt((current) => current + 1);
  };

  return <Config.Provider value={{ config, error, retry }}>{children}</Config.Provider>;
}

export function useMapConfig() {
  return useContext(Config);
}

export function mapTilerUrl(value: string, key: string, params?: Record<string, string>) {
  if (!value.startsWith(host + "/")) return value;
  const url = new URL(value);
  for (const [name, setting] of Object.entries(params ?? {})) url.searchParams.set(name, setting);
  url.searchParams.set("key", key);
  return url.href;
}

export function styleUrl(style: Basemap, key: string) {
  return mapTilerUrl(host + "/maps/" + mapStyles[style].id + "/style.json", key);
}

export function providerError(status?: number) {
  if (status === 429) return "MapTiler’s request limit was reached. Try again later.";
  if (status === 401 || status === 403)
    return "MapTiler denied access. Check the key and this app’s allowed origin.";
  return "MapTiler data could not be loaded. Try again or choose another basemap.";
}

type Feature = { id: string; place_name?: string; text?: string; center?: Point };
export type Place = { id: string; name: string; point: Point };

export function validMapPoint(point: Point) {
  return (
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 &&
    Math.abs(point[1]) <= 85.051129
  );
}

async function geocode(
  key: string,
  value: string,
  signal: AbortSignal,
  params: Record<string, string>,
) {
  const url = mapTilerUrl(
    host + "/geocoding/" + encodeURIComponent(value).replace(/%2C/g, ",") + ".json",
    key,
    params,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
  } catch {
    throw new Error("MapTiler location search is unavailable.");
  }
  if (!response.ok) throw new Error(providerError(response.status));

  const data: { features?: Feature[] } = await response.json();
  return (data.features ?? []).flatMap<Place>((feature) => {
    const name = feature.place_name || feature.text;
    return name && feature.center && validMapPoint(feature.center)
      ? [{ id: feature.id, name, point: feature.center }]
      : [];
  });
}

export function searchPakistan(key: string, query: string, signal: AbortSignal) {
  return geocode(key, query, signal, { country: "pk", limit: "5" });
}

export async function reverseLocation(key: string, point: Point, signal: AbortSignal) {
  const [place] = await geocode(key, point.join(","), signal, { limit: "1" });
  return place?.name;
}
