import area from "@turf/area";
import type { Field, Point } from "@/domain/data";
import { polygon } from "@/domain/registry";

const ACRE_M2 = 4046.8564224;

export function validMapPoint([longitude, latitude]: Point) {
  return Math.abs(longitude) <= 180 && Math.abs(latitude) <= 85.051129;
}

export const irrigationStyles = {
  canal_today: { label: "Canal turn today", color: "#2563eb" },
  configured: { label: "Supply configured", color: "#15803d" },
  setup_required: { label: "Setup required", color: "#b45309" },
  rain_fed: { label: "Rain-fed", color: "#64748b" },
};

export function irrigationStyle(field: Field) {
  return irrigationStyles[field.irrigation_status ?? "setup_required"];
}

export const cropStageStyles = [
  { label: "Initial", color: "#42863c" },
  { label: "Development", color: "#0f766e" },
  { label: "Mid-season", color: "#155b96" },
  { label: "Late season", color: "#a16207" },
  { label: "Outside modeled season / unavailable", color: "#6b7280" },
];

export function cropStageColor(stage: string) {
  return cropStageStyles.find(({ label }) => label === stage)?.color ?? cropStageStyles[4].color;
}

export function previewArea(points: Point[]) {
  if (points.length < 3 || points.length > 5000 || !points.every(validMapPoint)) return 0;
  return area(polygon(points)) / ACRE_M2;
}

export function validParcel(points: Point[]) {
  return (
    new Set(points.map((point) => point.join(","))).size === points.length &&
    previewArea(points) > 0
  );
}

export function areaUnits(acres: number) {
  return [
    [acres, "acres"],
    [acres * 8, "kanals"],
    [acres * 160, "marlas"],
    [(acres * ACRE_M2) / 10_000, "hectares"],
  ] as const;
}
