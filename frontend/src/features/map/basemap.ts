import type { LayerSpecification, RasterSourceSpecification } from "maplibre-gl";

export type Basemap = "street" | "satellite" | "hybrid";

const tiles = import.meta.env.VITE_SATELLITE_TILES?.trim();
const credit = import.meta.env.VITE_SATELLITE_ATTRIBUTION?.trim();
const license = import.meta.env.VITE_SATELLITE_LICENSE_URL?.trim();
const maxZoom = Number(import.meta.env.VITE_SATELLITE_MAX_ZOOM || 19);

function publicUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const satelliteSource: RasterSourceSpecification | undefined =
  tiles &&
  credit &&
  license &&
  publicUrl(tiles) &&
  publicUrl(license) &&
  ["{z}", "{x}", "{y}"].every((part) => tiles.includes(part)) &&
  Number.isInteger(maxZoom) &&
  maxZoom >= 0 &&
  maxZoom <= 24 &&
  import.meta.env.VITE_SATELLITE_DIGITIZATION_AUTHORIZED === "true"
    ? {
        type: "raster",
        tiles: [tiles],
        tileSize: 256,
        maxzoom: maxZoom,
        attribution: `<a href="${escapeHtml(license)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credit)}</a>`,
      }
    : undefined;

const hybridSourceLayers = new Set([
  "transportation",
  "transportation_name",
  "place",
  "boundary",
  "water_name",
]);

export function hybridLayer(layer: LayerSpecification) {
  return "source-layer" in layer && hybridSourceLayers.has(layer["source-layer"] ?? "");
}
