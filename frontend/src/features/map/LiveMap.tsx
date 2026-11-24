import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Field, Point, Region } from "@/domain/data";
import { polygon } from "@/domain/registry";

const centers: Record<Region, Point> = {
  Punjab: [73.079, 31.418],
  "Khyber Pakhtunkhwa": [72.0404, 34.1986],
};
const empty = { type: "FeatureCollection" as const, features: [] };
setWorkerUrl(workerUrl);

export default function LiveMap({
  region,
  fields,
  selected,
  onSelect,
  draft,
  onDraftChange,
}: {
  region: Region;
  fields: Field[];
  selected?: string;
  onSelect: (id: string) => void;
  draft?: Point[];
  onDraftChange?: (points: Point[]) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef({ onSelect, onDraftChange, draft });
  const [map, setMap] = useState<Map>();
  const [error, setError] = useState("");
  const drawing = draft !== undefined;

  useEffect(() => {
    refs.current = { onSelect, onDraftChange, draft };
  }, [onSelect, onDraftChange, draft]);

  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    try {
      instance = new Map({
        container: container.current,
        center: centers[region],
        zoom: 12,
        style: {
          version: 8,
          sources: {
            streets: {
              type: "raster",
              tiles: [
                import.meta.env.VITE_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              maxzoom: 19,
              attribution:
                '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
            },
            plots: { type: "geojson", data: empty },
          },
          layers: [
            { id: "streets", source: "streets", type: "raster" },
            {
              id: "plots",
              source: "plots",
              type: "fill",
              paint: {
                "fill-color": ["case", ["get", "selected"], "#e8ad32", "#18a66b"],
                "fill-opacity": 0.36,
              },
            },
            {
              id: "plot-edges",
              source: "plots",
              type: "line",
              paint: { "line-color": "#216747", "line-width": 2 },
            },
          ],
        },
      });
    } catch {
      setError("The live map requires a browser with WebGL.");
      return;
    }
    instance.addControl(new NavigationControl());
    instance.on("load", () => setMap(instance));
    instance.on("click", "plots", (event) => {
      const id = event.features?.[0]?.properties.id;
      if (typeof id === "string" && refs.current.draft === undefined) refs.current.onSelect(id);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      setMap(undefined);
      instance.remove();
    };
  }, [region]);

  useEffect(() => {
    if (!map) return;
    map.getSource<GeoJSONSource>("plots")?.setData({
      type: "FeatureCollection",
      features: fields
        .filter((field) => !(drawing && field.id === selected))
        .map((field) => ({
          type: "Feature",
          geometry: polygon(field.points),
          properties: { id: field.id, selected: field.id === selected },
        })),
    });
  }, [map, fields, selected, drawing]);

  const selectedField = fields.find((field) => field.id === selected);
  const selectedPoints = selectedField?.points;
  useEffect(() => {
    if (!map || !selectedPoints?.length) return;
    const bounds = new LngLatBounds();
    selectedPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { padding: 44, maxZoom: 18, duration: 0 });
  }, [map, selectedPoints]);

  useEffect(() => {
    if (!map || !drawing) return;
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 8 }),
      modes: [
        new TerraDrawPolygonMode(),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                selfIntersectable: false,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
          },
        }),
      ],
    });
    let featureId: string | number | undefined;
    const emit = () => {
      if (featureId === undefined) return;
      const shape = draw.getSnapshotFeature(featureId);
      if (shape?.geometry.type === "Polygon") {
        refs.current.onDraftChange?.(
          shape.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [x, y]),
        );
      }
    };
    draw.start();
    draw.setMode("polygon");
    const initial = refs.current.draft;
    if (initial && initial.length >= 3) {
      featureId = crypto.randomUUID();
      draw.addFeatures([
        {
          id: featureId,
          type: "Feature",
          geometry: polygon(initial),
          properties: { mode: "polygon" },
        },
      ]);
      draw.setMode("select");
      draw.selectFeature(featureId);
    }
    draw.on("finish", (id) => {
      if (featureId !== undefined) return;
      featureId = id;
      draw.setMode("select");
      draw.selectFeature(id);
      emit();
    });
    draw.on("change", emit);
    return () => {
      draw.off("change", emit);
      if (map.getStyle()) draw.stop();
    };
  }, [map, drawing]);

  return (
    <div ref={container} className="geo-canvas" role="region" aria-label="Live farm map">
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
