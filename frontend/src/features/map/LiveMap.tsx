import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  LngLatBounds,
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type GeoJSONSourceDiff,
  type RasterTileSource,
  type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  TerraDraw,
  TerraDrawModeUndoRedo,
  TerraDrawSessionUndoRedo,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui";
import type { Field, Point } from "@/domain/data";
import { polygon } from "@/domain/registry";
import { cropStageColor, irrigationStyle } from "./parcel";
import { arcgisRequest, arcgisStyle, type Basemap } from "./basemap";

const PAKISTAN: [Point, Point] = [
  [60.8, 23.5],
  [77.9, 37.2],
];
const streetTiles =
  import.meta.env.VITE_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const libertyStyle = "https://tiles.openfreemap.org/styles/liberty";
const rasterStyle: StyleSpecification = {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: [streetTiles],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    },
  },
  layers: [{ id: "streets", source: "streets", type: "raster" }],
};
const plots = "aquaproof-parcels";
const edges = "aquaproof-parcel-edges";
const weatherLayer = "aquaproof-weather";
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
  clearDraft?: number;
  resetView?: number;
  basemap?: Basemap;
  arcgisToken?: string | null;
  arcgisServer?: boolean;
  colorMode?: "irrigation" | "crop";
  weatherPoint?: { point: Point; temperature_c: number };
};

function parcelFeature(field: Field) {
  return {
    type: "Feature" as const,
    id: field.id,
    geometry: polygon(field.points),
    properties: {
      id: field.id,
      color: irrigationStyle(field).color,
      stageColor: cropStageColor(field.stage),
    },
  };
}

function parcelData(fields: Field[]) {
  return { type: "FeatureCollection" as const, features: fields.map(parcelFeature) };
}

function parcelChanges(before: Field[], after: Field[]) {
  const pending = new globalThis.Map(before.map((field) => [field.id, field]));
  const add: NonNullable<GeoJSONSourceDiff["add"]> = [];
  const update: NonNullable<GeoJSONSourceDiff["update"]> = [];
  for (const field of after) {
    const previous = pending.get(field.id);
    pending.delete(field.id);
    if (!previous) add.push(parcelFeature(field));
    else if (
      previous.points !== field.points ||
      previous.irrigation_status !== field.irrigation_status ||
      previous.stage !== field.stage
    ) {
      update.push({
        id: field.id,
        newGeometry: polygon(field.points),
        addOrUpdateProperties: [
          { key: "color", value: irrigationStyle(field).color },
          { key: "stageColor", value: cropStageColor(field.stage) },
        ],
      });
    }
  }
  return { add, update, remove: [...pending.keys()] };
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
  clearDraft = 0,
  resetView = 0,
  basemap = "street",
  arcgisToken,
  arcgisServer,
  colorMode = "irrigation",
  weatherPoint,
}: LiveMapProps) {
  const drawing = draft !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef({
    fields,
    selected,
    onSelect,
    onDraftChange,
    onPreview,
    draft,
    drawing,
  });
  const [map, setMap] = useState<Map>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [activeStyle, setActiveStyle] = useState(0);
  const clearDrawing = useRef<(() => void) | null>(null);
  const sourceFields = useRef<Field[]>([]);
  const arcgis = useRef(false);
  const requestedStyle = useRef<string | undefined>(undefined);
  const token = useRef(arcgisToken);
  const stopDrawing = useRef<(() => void) | null>(null);
  const redoUndo = useRef<((action: "undo" | "redo") => void) | null>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const styleTimer = useRef<number>(undefined);
  const [arcgisFailed, setArcgisFailed] = useState(false);
  const arcgisAvailable = Boolean(arcgisToken || arcgisServer);

  useEffect(() => {
    refs.current = {
      fields,
      selected,
      onSelect,
      onDraftChange,
      onPreview,
      draft,
      drawing,
    };
  }, [fields, selected, onSelect, onDraftChange, onPreview, draft, drawing]);

  useEffect(() => {
    onReady?.(ready);
  }, [onReady, ready]);

  useEffect(() => {
    if (!container.current) return;
    requestedStyle.current = undefined;
    arcgis.current = false;
    let instance: Map;
    let usingRaster = Boolean(import.meta.env.VITE_MAP_TILES);
    try {
      instance = new Map({
        container: container.current,
        bounds: PAKISTAN,
        fitBoundsOptions: { padding: 22 },
        renderWorldCopies: false,
        style: usingRaster ? rasterStyle : libertyStyle,
        transformRequest: (url) => arcgisRequest(url, token.current),
        attributionControl: false,
        maxTileCacheSize: 192,
        maxTileCacheZoomLevels: 3,
      });
    } catch {
      setError("The live map requires WebGL. Map search and registry records remain available.");
      return;
    }
    setMap(instance);
    instance.addControl(new NavigationControl());
    instance.addControl(new ScaleControl({ unit: "metric" }));
    instance.addControl(new AttributionControl({ compact: false }));
    const useStreetTiles = () => {
      if (usingRaster || arcgis.current || instance.getSource(plots)) return;
      usingRaster = true;
      instance.setStyle(rasterStyle, { diff: false });
    };
    const styleTimeout = window.setTimeout(useStreetTiles, 8000);
    instance.on("error", () => {
      if (arcgis.current) {
        setError("ArcGIS map resources are unavailable. The open street basemap is active.");
        setArcgisFailed(true);
        return;
      }
      if (!usingRaster && !instance.getSource(plots)) {
        useStreetTiles();
        return;
      }
      setError("Some map tiles are unavailable. You can retry the basemap.");
    });
    instance.on("style.load", () => {
      window.clearTimeout(styleTimeout);
      window.clearTimeout(styleTimer.current);
      sourceFields.current = refs.current.fields;
      instance.addSource(plots, {
        type: "geojson",
        data: parcelData(sourceFields.current),
      });
      instance.addLayer({
        id: plots,
        source: plots,
        type: "fill",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hidden"], false],
            0,
            ["boolean", ["feature-state", "selected"], false],
            0.56,
            0.34,
          ],
        },
      });
      instance.addLayer({
        id: edges,
        source: plots,
        type: "line",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 4, 2],
          "line-opacity": ["case", ["boolean", ["feature-state", "hidden"], false], 0, 1],
        },
      });
      setActiveStyle((current) => current + 1);
      setReady(true);
    });
    instance.on("click", (event) => {
      if (refs.current.drawing || !instance.getLayer(plots)) return;
      const id = instance.queryRenderedFeatures(event.point, { layers: [plots] })[0]?.properties.id;
      if (typeof id === "string") refs.current.onSelect(id);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      window.clearTimeout(styleTimeout);
      window.clearTimeout(styleTimer.current);
      observer.disconnect();
      setReady(false);
      setMap(undefined);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    token.current = arcgisToken;
    if (!map || (!arcgisAvailable && !arcgis.current)) return;
    if (arcgisAvailable && drawing && !draft?.length) return;
    const useEsri = arcgisAvailable && !arcgisFailed;
    const identity = useEsri ? `${arcgisToken ? "direct" : "server"}:${basemap}` : "open";
    if (requestedStyle.current === identity) return;
    window.clearTimeout(styleTimer.current);
    requestedStyle.current = identity;
    stopDrawing.current?.();
    setReady(false);
    arcgis.current = useEsri;
    const style = useEsri
      ? arcgisToken
        ? arcgisStyle(basemap)
        : `/api/map/basemap-style/${basemap}`
      : rasterStyle;
    map.setStyle(style, { diff: false });
    if (useEsri) {
      styleTimer.current = window.setTimeout(() => {
        setError("ArcGIS map loading timed out. The open street basemap is active.");
        setArcgisFailed(true);
      }, 12_000);
    }
  }, [map, arcgisAvailable, arcgisToken, basemap, arcgisFailed, drawing, Boolean(draft?.length)]);

  useEffect(() => {
    if (!map || !attempt) return;
    setError("");
    if (arcgisFailed && arcgisAvailable) {
      setArcgisFailed(false);
      return;
    }
    const raster = map.getSource<RasterTileSource>("streets");
    if (raster) raster.setTiles([streetTiles]);
    else {
      setReady(false);
      map.setStyle(rasterStyle, { diff: false });
    }
  }, [map, attempt]);

  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>(plots);
    if (!source || sourceFields.current === fields) return;
    const previous = sourceFields.current;
    sourceFields.current = fields;
    if (!previous.length || !fields.length) {
      void source.setData(parcelData(fields));
      return;
    }
    const changes = parcelChanges(previous, fields);
    if (changes.add.length || changes.update.length || changes.remove.length) {
      void source.updateData(changes).catch(() => {
        if (map?.getSource(plots) === source) void source.setData(parcelData(sourceFields.current));
      });
    }
  }, [map, fields, activeStyle]);

  useEffect(() => {
    if (!map?.getLayer(plots) || !map.getLayer(edges)) return;
    const property = colorMode === "crop" ? "stageColor" : "color";
    map.setPaintProperty(plots, "fill-color", ["get", property]);
    map.setPaintProperty(edges, "line-color", ["get", property]);
  }, [map, colorMode, activeStyle]);

  useEffect(() => {
    if (!map?.getLayer(plots)) return;
    const data = {
      type: "FeatureCollection" as const,
      features: weatherPoint
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: weatherPoint.point },
              properties: { temperature: weatherPoint.temperature_c },
            },
          ]
        : [],
    };
    const source = map.getSource<GeoJSONSource>(weatherLayer);
    if (source) {
      void source.setData(data);
      return;
    }
    map.addSource(weatherLayer, { type: "geojson", data });
    map.addLayer({
      id: weatherLayer,
      type: "circle",
      source: weatherLayer,
      paint: {
        "circle-radius": 9,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "temperature"],
          0,
          "#1d4ed8",
          25,
          "#0e7490",
          40,
          "#c2410c",
        ],
      },
    });
  }, [map, weatherPoint, activeStyle]);

  useEffect(() => {
    const source = map?.getSource(plots);
    if (!map || !source || !selected) return;
    const feature = { source: plots, id: selected };
    let applied = false;
    const apply = () => {
      if (applied || map.getSource(plots) !== source || !map.isSourceLoaded(plots)) return;
      map.setFeatureState(feature, { selected: true, hidden: drawing });
      applied = true;
    };
    const subscription = map.on("sourcedata", (event) => {
      if (event.sourceId === plots) apply();
    });
    apply();
    return () => {
      subscription.unsubscribe();
      if (applied && map.getSource(plots) === source) map.removeFeatureState(feature);
    };
  }, [map, selected, drawing, activeStyle, fields]);

  const selectedPoints = fields.find((field) => field.id === selected)?.points;
  useEffect(() => {
    if (!map || !focusField || !selectedPoints?.length || target) return;
    const bounds = new LngLatBounds();
    selectedPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { padding: 44, maxZoom: 18, duration: 600, linear: true });
  }, [map, focusField, selectedPoints, target]);

  useEffect(() => {
    if (map && target) map.flyTo({ center: target, zoom: 16, duration: 900 });
  }, [map, target]);

  useEffect(() => {
    if (map && resetView) map.fitBounds(PAKISTAN, { padding: 22, duration: 700 });
  }, [map, resetView]);

  useEffect(() => {
    if (!map || !ready || !drawing || !map.getSource(plots)) return;
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 8 }),
      undoRedo: {
        modeLevel: new TerraDrawModeUndoRedo(),
        sessionLevel: new TerraDrawSessionUndoRedo(),
      },
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
      const shape = draw.getSnapshot().find((item) => item.geometry.type === "Polygon");
      if (shape && draw.getMode() === "select") featureId = shape.id;
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
        setError("The saved boundary could not be opened for editing.");
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
    const syncHistory = () => setHistory({ undo: draw.canUndo(), redo: draw.canRedo() });
    draw.on("history", syncHistory);
    syncHistory();
    clearDrawing.current = () => {
      featureId = undefined;
      draw.clear();
      draw.setMode("polygon");
      refs.current.onPreview?.([]);
      refs.current.onDraftChange?.([]);
    };
    redoUndo.current = (action) => {
      if (action === "redo") draw.redo();
      else draw.undo();
      emit();
      syncHistory();
    };
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase()))
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      event.preventDefault();
      redoUndo.current?.(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
    };
    window.addEventListener("keydown", shortcuts);
    const stop = () => {
      if (stopDrawing.current !== stop) return;
      stopDrawing.current = null;
      clearDrawing.current = null;
      redoUndo.current = null;
      window.removeEventListener("keydown", shortcuts);
      draw.off("change", emit);
      draw.off("history", syncHistory);
      if (map.getStyle()) draw.stop();
    };
    stopDrawing.current = stop;
    return stop;
  }, [map, ready, drawing, activeStyle]);

  useEffect(() => {
    if (clearDraft) clearDrawing.current?.();
  }, [clearDraft]);

  return (
    <div className="geo-canvas live-map" role="region" aria-label="Live farm map">
      <div ref={container} className="live-map-canvas" />
      {ready && drawing && (
        <div className="boundary-history-controls">
          <Button disabled={!history.undo} onClick={() => redoUndo.current?.("undo")}>
            Undo
          </Button>
          <Button disabled={!history.redo} onClick={() => redoUndo.current?.("redo")}>
            Redo
          </Button>
        </div>
      )}
      {arcgisAvailable && !arcgisFailed && ready && (
        <a className="esri-credit" href="https://www.esri.com/" target="_blank" rel="noreferrer">
          Powered by Esri
        </a>
      )}
      {(error || !ready) && (
        <div className="live-map-status" role={error ? "alert" : "status"}>
          <span>{error || "Loading map…"}</span>
          {error && map && !drawing && (
            <Button onClick={() => setAttempt((count) => count + 1)}>Retry basemap</Button>
          )}
        </div>
      )}
    </div>
  );
}
