import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  LngLatBounds,
  Map,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui";
import type { Field, Point } from "@/domain/data";
import { polygon } from "@/domain/registry";
import { type Basemap, mapTilerUrl, providerError, styleUrl, useMapConfig } from "./maptiler";
import { irrigationStyle } from "./parcel";

const PAKISTAN: [Point, Point] = [
  [60.8, 23.5],
  [77.9, 37.2],
];
const TILE_LOGO = "https://api.maptiler.com/resources/logo.svg";
const plots = "aquaproof-parcels";
const edges = "aquaproof-parcel-edges";
setWorkerUrl(workerUrl);

export type LiveMapProps = {
  fields: Field[];
  selected?: string;
  focusField?: boolean;
  onSelect: (id: string) => void;
  draft?: Point[];
  onDraftChange?: (points: Point[]) => void;
  onPreview?: (points: Point[]) => void;
  onReady?: (ready: boolean) => void;
  target?: Point;
  basemap?: Basemap;
  clearDraft?: number;
  resetView?: number;
};

function parcelData(fields: Field[], selected?: string, drawing = false) {
  return {
    type: "FeatureCollection" as const,
    features: fields
      .filter((field) => !(drawing && field.id === selected))
      .map((field) => ({
        type: "Feature" as const,
        geometry: polygon(field.points),
        properties: {
          id: field.id,
          selected: field.id === selected,
          color: irrigationStyle(field).color,
        },
      })),
  };
}

export default function LiveMap({
  fields,
  selected,
  focusField = true,
  onSelect,
  draft,
  onDraftChange,
  onPreview,
  onReady,
  target,
  basemap = "satellite",
  clearDraft = 0,
  resetView = 0,
}: LiveMapProps) {
  const { config, error: configError, retry } = useMapConfig();
  const key = config?.api_key;
  const drawing = config?.tracing_authorized === true && draft !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef({
    fields,
    selected,
    onSelect,
    onDraftChange,
    onPreview,
    draft,
    drawing,
    basemap,
  });
  const [map, setMap] = useState<Map>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const applied = useRef<{ basemap: Basemap; attempt: number } | undefined>(undefined);
  const clearDrawing = useRef<(() => void) | null>(null);

  useEffect(() => {
    refs.current = {
      fields,
      selected,
      onSelect,
      onDraftChange,
      onPreview,
      draft,
      drawing,
      basemap,
    };
  }, [fields, selected, onSelect, onDraftChange, onPreview, draft, drawing, basemap]);

  useEffect(() => {
    onReady?.(ready && !error && Boolean(key));
  }, [onReady, ready, error, key]);

  useEffect(() => {
    if (!container.current || !key) return;
    let instance: Map;
    try {
      const initial = refs.current.basemap;
      instance = new Map({
        container: container.current,
        bounds: PAKISTAN,
        fitBoundsOptions: { padding: 22 },
        renderWorldCopies: false,
        style: styleUrl(initial, key),
        attributionControl: false,
        transformRequest: (url) => ({ url: mapTilerUrl(url, key) }),
      });
      applied.current = { basemap: initial, attempt: 0 };
    } catch {
      setError("The live map requires WebGL. Map search and registry records remain available.");
      return;
    }
    setMap(instance);
    instance.addControl(new NavigationControl());
    instance.addControl(new AttributionControl({ compact: false }));
    instance.on("error", (event) => {
      setError(providerError("status" in event.error ? Number(event.error.status) : undefined));
    });
    instance.on("style.load", () => {
      const state = refs.current;
      instance.addSource(plots, {
        type: "geojson",
        data: parcelData(state.fields, state.selected, state.drawing),
      });
      instance.addLayer({
        id: plots,
        source: plots,
        type: "fill",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "selected"], 0.56, 0.34],
        },
      });
      instance.addLayer({
        id: edges,
        source: plots,
        type: "line",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "selected"], 4, 2],
        },
      });
    });
    instance.on("idle", () => {
      if (instance.getSource(plots)) setReady(true);
    });
    instance.on("click", (event) => {
      if (refs.current.drawing || !instance.getLayer(plots)) return;
      const id = instance.queryRenderedFeatures(event.point, { layers: [plots] })[0]?.properties.id;
      if (typeof id === "string") refs.current.onSelect(id);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      setReady(false);
      setMap(undefined);
      instance.remove();
    };
  }, [key]);

  useEffect(() => {
    if (
      !map ||
      !key ||
      (applied.current?.basemap === basemap && applied.current.attempt === attempt)
    )
      return;
    applied.current = { basemap, attempt };
    setReady(false);
    setError("");
    map.setStyle(styleUrl(basemap, key), { diff: false });
  }, [map, basemap, attempt, key]);

  useEffect(() => {
    map?.getSource<GeoJSONSource>(plots)?.setData(parcelData(fields, selected, drawing));
  }, [map, fields, selected, drawing]);

  const selectedPoints = fields.find((field) => field.id === selected)?.points;
  useEffect(() => {
    if (!map || !focusField || !selectedPoints?.length || target) return;
    const bounds = new LngLatBounds();
    selectedPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { padding: 44, maxZoom: 18, duration: 0 });
  }, [map, focusField, selectedPoints, target]);

  useEffect(() => {
    if (map && target) map.jumpTo({ center: target, zoom: 15 });
  }, [map, target]);

  useEffect(() => {
    if (map && resetView) map.fitBounds(PAKISTAN, { padding: 22, duration: 0 });
  }, [map, resetView]);

  useEffect(() => {
    if (!map || !ready || !drawing) return;
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 8 }),
      modes: [
        new TerraDrawPolygonMode({ validation: ValidateNotSelfIntersecting }),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                selfIntersectable: false,
                validation: ValidateNotSelfIntersecting,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
          },
        }),
      ],
    });
    let featureId: string | number | undefined;
    const emit = () => {
      const shape =
        featureId === undefined
          ? draw.getSnapshot().find((item) => item.geometry.type === "Polygon")
          : draw.getSnapshotFeature(featureId);
      if (shape?.geometry.type === "Polygon") {
        const ring = shape.geometry.coordinates[0];
        const points = (
          ring[0]?.join(",") === ring.at(-1)?.join(",") ? ring.slice(0, -1) : ring
        ).map(([x, y]): Point => [x, y]);
        refs.current.onPreview?.(points);
        if (featureId !== undefined) refs.current.onDraftChange?.(points);
      } else {
        refs.current.onPreview?.([]);
        if (featureId !== undefined) {
          featureId = undefined;
          refs.current.onDraftChange?.([]);
          draw.setMode("polygon");
        }
      }
    };
    draw.start();
    draw.setMode("polygon");
    const initial = refs.current.draft;
    if (initial && initial.length >= 3) {
      featureId = crypto.randomUUID();
      const [added] = draw.addFeatures([
        {
          id: featureId,
          type: "Feature",
          geometry: polygon(initial),
          properties: { mode: "polygon" },
        },
      ]);
      if (added?.valid) {
        draw.setMode("select");
        draw.selectFeature(featureId);
      } else {
        featureId = undefined;
        refs.current.onDraftChange?.([]);
      }
    }
    draw.on("finish", (id) => {
      if (featureId !== undefined) return;
      featureId = id;
      draw.setMode("select");
      draw.selectFeature(id);
      emit();
    });
    draw.on("change", emit);
    clearDrawing.current = () => {
      featureId = undefined;
      draw.clear();
      draw.setMode("polygon");
      refs.current.onPreview?.([]);
      refs.current.onDraftChange?.([]);
    };
    return () => {
      clearDrawing.current = null;
      draw.off("change", emit);
      if (map.getStyle()) draw.stop();
    };
  }, [map, ready, drawing]);

  useEffect(() => {
    if (clearDraft) clearDrawing.current?.();
  }, [clearDraft]);

  return (
    <div className="geo-canvas maptiler-workspace" role="region" aria-label="Live farm map">
      <div ref={container} className="maptiler-canvas" />
      {ready && key && (
        <a
          className="maptiler-logo"
          href="https://www.maptiler.com/"
          target="_blank"
          rel="noopener"
        >
          <img src={mapTilerUrl(TILE_LOGO, key)} alt="MapTiler" />
        </a>
      )}
      {(configError || error || !ready) && (
        <div className="maptiler-status" role={configError || error ? "alert" : "status"}>
          <span>{configError || error || "Loading MapTiler…"}</span>
          {(configError || (error && map)) && (
            <Button onClick={configError ? retry : () => setAttempt((count) => count + 1)}>
              Retry map
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
