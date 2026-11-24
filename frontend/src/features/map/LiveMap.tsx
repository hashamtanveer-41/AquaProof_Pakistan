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
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui";
import type { Field, Point } from "@/domain/data";
import { polygon } from "@/domain/registry";
import { irrigationStyle } from "./parcel";
import { hybridLayer, satelliteSource, type Basemap } from "./basemap";

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
const imagery = "aquaproof-satellite";
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
  onImageryError?: () => void;
};

function parcelFeature(field: Field) {
  return {
    type: "Feature" as const,
    id: field.id,
    geometry: polygon(field.points),
    properties: { id: field.id, color: irrigationStyle(field).color },
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
      previous.irrigation_status !== field.irrigation_status
    ) {
      update.push({
        id: field.id,
        newGeometry: polygon(field.points),
        addOrUpdateProperties: [{ key: "color", value: irrigationStyle(field).color }],
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
  onImageryError,
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
    onImageryError,
  });
  const [map, setMap] = useState<Map>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadingTiles, setLoadingTiles] = useState(false);
  const [activeStyle, setActiveStyle] = useState(0);
  const [hybridAvailable, setHybridAvailable] = useState(false);
  const clearDrawing = useRef<(() => void) | null>(null);
  const baseLayers = useRef<ReturnType<Map["getStyle"]>["layers"]>([]);
  const sourceFields = useRef<Field[]>([]);
  const imageryLoaded = useRef(false);

  useEffect(() => {
    refs.current = {
      fields,
      selected,
      onSelect,
      onDraftChange,
      onPreview,
      draft,
      drawing,
      onImageryError,
    };
  }, [fields, selected, onSelect, onDraftChange, onPreview, draft, drawing, onImageryError]);

  useEffect(() => {
    onReady?.(ready);
  }, [onReady, ready]);

  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    let usingRaster = Boolean(import.meta.env.VITE_MAP_TILES);
    try {
      instance = new Map({
        container: container.current,
        bounds: PAKISTAN,
        fitBoundsOptions: { padding: 22 },
        renderWorldCopies: false,
        style: usingRaster ? rasterStyle : libertyStyle,
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
      if (usingRaster || instance.getSource(plots)) return;
      usingRaster = true;
      instance.setStyle(rasterStyle, { diff: false });
    };
    const styleTimeout = window.setTimeout(useStreetTiles, 8000);
    instance.on("error", (event) => {
      if ("sourceId" in event && event.sourceId === imagery) {
        setLoadingTiles(false);
        refs.current.onImageryError?.();
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
      imageryLoaded.current = false;
      baseLayers.current = instance.getStyle().layers;
      setHybridAvailable(baseLayers.current.some(hybridLayer));
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
    instance.on("sourcedata", (event) => {
      if (event.sourceId === imagery && event.coord && event.sourceDataType === "content") {
        imageryLoaded.current = true;
      }
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
      observer.disconnect();
      setReady(false);
      setMap(undefined);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    if (!map || !attempt) return;
    setError("");
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
    if (!map?.getSource(plots) || !selected) return;
    const feature = { source: plots, id: selected };
    map.setFeatureState(feature, { selected: true, hidden: drawing });
    return () => {
      if (map.getSource(plots)) map.removeFeatureState(feature);
    };
  }, [map, selected, drawing, activeStyle, fields]);

  useEffect(() => {
    if (!map?.getSource(plots)) return;
    if (basemap !== "street" && satelliteSource && !map.getSource(imagery)) {
      map.addSource(imagery, satelliteSource);
      map.addLayer(
        { id: imagery, type: "raster", source: imagery },
        baseLayers.current[0]?.id ?? plots,
      );
    }
    if (!map.getLayer(imagery)) return;
    const street = basemap === "street";
    const addLabels = basemap === "hybrid" && hybridAvailable;
    map.setLayoutProperty(imagery, "visibility", street ? "none" : "visible");
    for (const layer of baseLayers.current) {
      const visibility =
        street || (addLabels && hybridLayer(layer)) ? layer.layout?.visibility : "none";
      map.setLayoutProperty(layer.id, "visibility", visibility ?? "visible");
    }
    setLoadingTiles(!street);
    if (street) return;
    const endLoading = () => {
      setLoadingTiles(false);
      if (!imageryLoaded.current) refs.current.onImageryError?.();
    };
    map.once("idle", endLoading);
    const timeout = window.setTimeout(endLoading, 12_000);
    return () => {
      map.off("idle", endLoading);
      window.clearTimeout(timeout);
    };
  }, [map, basemap, activeStyle, hybridAvailable]);

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
    <div className="geo-canvas live-map" role="region" aria-label="Live farm map">
      <div ref={container} className="live-map-canvas" />
      {(error || !ready || loadingTiles || (basemap === "hybrid" && !hybridAvailable)) && (
        <div className="live-map-status" role={error ? "alert" : "status"}>
          <span>
            {error ||
              (!ready
                ? "Loading map…"
                : loadingTiles
                  ? "Loading imagery…"
                  : "Street labels are unavailable.")}
          </span>
          {error && map && !drawing && (
            <Button onClick={() => setAttempt((count) => count + 1)}>Retry basemap</Button>
          )}
        </div>
      )}
    </div>
  );
}
