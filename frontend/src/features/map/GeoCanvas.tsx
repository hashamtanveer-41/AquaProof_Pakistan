import { lazy, Suspense, useRef, useState } from "react";
import { connected } from "@/domain/registry";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  CircleHelp,
  Hand,
  LocateFixed,
  MapPin,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  SquareDashed,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { acres, localWeather, measure, demoRegion, validBoundary } from "@/domain/data";
import type { Field, Point, Region } from "@/domain/data";
import { Button } from "@/components/ui";

const polygon = (pts: Point[]) => pts.map((p) => p.join(",")).join(" ");
const center = (pts: Point[]): Point => [
  pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
  pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
];

const LiveMap = lazy(() => import("./LiveMap"));

export function GeoCanvas(
  props: Parameters<typeof DemoCanvas>[0] & {
    onDraftChange?: (points: Point[]) => void;
    target?: Point;
  },
) {
  return connected ? (
    <Suspense
      fallback={
        <div className="geo-canvas" role="status">
          Loading map…
        </div>
      }
    >
      <LiveMap {...props} />
    </Suspense>
  ) : (
    <DemoCanvas {...props} />
  );
}

function DemoCanvas({
  region,
  fields,
  selected,
  onSelect,
  satellite = true,
  tool = "pointer",
  draft,
  editing = false,
  activePoint,
  setActivePoint,
  onPoint,
  onUndo,
  onClear,
  onSave,
  onTool,
  full,
  setFull,
  weather = false,
}: {
  region: Region;
  fields: Field[];
  selected?: string;
  onSelect: (id: string) => void;
  satellite?: boolean;
  tool?: string;
  draft?: Point[];
  activePoint?: number | null;
  setActivePoint?: (i: number) => void;
  onPoint?: (p: Point) => void;
  onUndo?: () => void;
  onClear?: () => void;
  onSave?: () => void;
  onTool?: (tool: string) => void;
  full?: boolean;
  setFull?: (v: boolean) => void;
  weather?: boolean;
  editing?: boolean;
}) {
  const map = demoRegion(region);
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; left: number; top: number }>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [help, setHelp] = useState(false);
  const scaleDistance = zoom > 2 ? 100 : 200;
  const changeZoom = (amount: number) => {
    const next = Math.min(3, Math.max(1, zoom + amount));
    setZoom(next);
    if (viewport.current) {
      const x = (viewport.current.offsetWidth * (next - 1)) / 2,
        y = (viewport.current.offsetHeight * (next - 1)) / 2;
      setPan((previous) => ({
        x: Math.min(x, Math.max(-x, previous.x)),
        y: Math.min(y, Math.max(-y, previous.y)),
      }));
    }
  };
  function handlePoint(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draft || !plane.current) return;
    const rect = plane.current.getBoundingClientRect();
    onPoint?.([
      Math.round(((e.clientX - rect.left) * 1000) / rect.width),
      Math.round(((e.clientY - rect.top) * 600) / rect.height),
    ]);
  }
  function panMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current || !viewport.current) return;
    const limitX = (viewport.current.offsetWidth * (zoom - 1)) / 2;
    const limitY = (viewport.current.offsetHeight * (zoom - 1)) / 2;
    setPan({
      x: Math.min(limitX, Math.max(-limitX, gesture.current.left + e.clientX - gesture.current.x)),
      y: Math.min(limitY, Math.max(-limitY, gesture.current.top + e.clientY - gesture.current.y)),
    });
  }
  return (
    <div
      ref={viewport}
      className={`geo-canvas ${satellite ? "is-satellite" : "is-standard"} tool-${draft ? "draw" : tool}`}
    >
      <div
        ref={plane}
        className="map-plane"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          backgroundImage: satellite ? `url(${map.image})` : undefined,
        }}
        onPointerDown={(e) => {
          if (draft) handlePoint(e);
          else if (tool === "pan") {
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture.current = { x: e.clientX, y: e.clientY, left: pan.x, top: pan.y };
          }
        }}
        onPointerMove={panMove}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      >
        {!satellite && (
          <svg
            viewBox="0 0 1000 600"
            preserveAspectRatio="none"
            className="map-vectors standard-vectors"
            aria-hidden="true"
          >
            <defs>
              <pattern
                id="parcels"
                width="53"
                height="34"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(-12)"
              >
                <rect
                  x="2"
                  y="2"
                  width="49"
                  height="30"
                  fill="#dce9ce"
                  stroke="#cddfbe"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="1000" height="600" fill="url(#parcels)" />
            <path
              d="M0 161L1000 105M440 0L560 600M0 485L1000 435M830 0L975 600M0 314L1000 275"
              fill="none"
              stroke="#faf7ed"
              strokeWidth="8"
            />
            <path
              d={
                region === "Punjab"
                  ? "M -20 606 L 364 376 L 540 237 L 861 -20"
                  : "M 821 -20 Q 726 142 874 249 T 971 618"
              }
              fill="none"
              stroke="#9bc8db"
              strokeWidth="8"
            />
            <path
              d="M0 101L122 76L148 115L88 170L0 184Z M889 275L1000 230L1000 338L931 364Z"
              fill="#e9dfc9"
              opacity=".92"
            />
          </svg>
        )}
        <span className="geolabel town-a">{map.village}</span>
        <span className="geolabel town-b">{region === "Punjab" ? "Chak 209 RB" : "Shergarh"}</span>
        <span className="geolabel canal-name">{map.canal}</span>
        <span className="geolabel road-name">{map.road}</span>
        <svg
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          className="map-vectors field-vectors"
          aria-label="Selectable demonstration farm boundaries"
        >
          {fields
            .filter((f) => f.id !== (draft && editing ? selected : undefined))
            .map((field) => (
              <polygon
                key={field.id}
                points={polygon(field.points)}
                className={`parcel ${selected === field.id ? "is-selected" : ""}`}
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={draft || tool === "pan" ? -1 : 0}
                aria-label={`Select ${field.name}`}
                aria-pressed={selected === field.id}
                onClick={() => {
                  if (!draft && tool !== "pan") onSelect(field.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!draft) onSelect(field.id);
                  }
                }}
              />
            ))}
          {draft && (
            <>
              <polygon
                className="parcel is-selected draft-parcel"
                points={polygon(draft)}
                vectorEffect="non-scaling-stroke"
              />
              {draft.map(([x, y], i) => (
                <circle
                  className={`vertex ${activePoint === i ? "active" : ""}`}
                  key={i}
                  cx={x}
                  cy={y}
                  r="7"
                  role="button"
                  tabIndex={0}
                  aria-label={`Select point ${i + 1} to move or delete`}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setActivePoint?.(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setActivePoint?.(i);
                  }}
                />
              ))}
            </>
          )}
        </svg>
        {!draft &&
          fields.map((field) => {
            const [x, y] = center(field.points);
            return (
              <button
                key={field.id}
                className={`field-pin ${selected === field.id ? "selected" : ""} ${weather ? "weather-pin" : ""}`}
                style={{ left: `${x / 10}%`, top: `${y / 6}%` }}
                onClick={() => {
                  if (tool !== "pan") onSelect(field.id);
                }}
                aria-label={`Select ${field.name}`}
              >
                <span>
                  <MapPin size={13} fill="currentColor" />
                </span>
                {selected === field.id && (
                  <b>
                    {weather ? `${localWeather(field).temperature}°C · ${field.village}` : field.id}
                  </b>
                )}
              </button>
            );
          })}
      </div>
      {onTool && (
        <div className="map-toolstack">
          <div className="map-toolgroup">
            <button
              className={tool === "pointer" && !draft ? "active" : ""}
              onClick={() => onTool("pointer")}
              title="Select field"
              aria-label="Select field"
            >
              <MousePointer2 size={16} />
            </button>
            <button
              className={tool === "pan" && !draft ? "active" : ""}
              onClick={() => {
                if (zoom === 1 && !draft) changeZoom(0.3);
                onTool("pan");
              }}
              title="Pan map"
              aria-label="Pan map"
            >
              <Hand size={17} />
            </button>
            <button
              className={draft ? "active" : ""}
              onClick={() => onTool("draw")}
              title="Draw boundary"
              aria-label="Draw boundary"
            >
              <SquareDashed size={17} />
            </button>
          </div>
          {draft && (
            <div className="map-toolgroup">
              <button
                onClick={onUndo}
                disabled={!draft.length}
                title="Undo point"
                aria-label="Undo point"
              >
                <Undo2 size={16} />
              </button>
              <button
                disabled={!draft.length}
                onClick={onClear}
                title={activePoint == null ? "Clear points" : "Delete selected point"}
                aria-label={activePoint == null ? "Clear points" : "Delete selected point"}
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="map-right-tools">
        <div className="map-toolgroup">
          <button
            onClick={() => changeZoom(0.3)}
            disabled={zoom >= 3}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => changeZoom(-0.3)}
            disabled={zoom <= 1}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={18} />
          </button>
        </div>
        <div className="map-toolgroup">
          <button
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setZoom(1);
            }}
            title="Reset map view"
            aria-label="Reset map view"
          >
            <LocateFixed size={17} />
          </button>
          {setFull && (
            <button
              onClick={() => setFull(!full)}
              title={full ? "Exit expanded map" : "Expand map"}
              aria-label={full ? "Exit expanded map" : "Expand map"}
            >
              {full ? <X size={17} /> : <Maximize size={16} />}
            </button>
          )}
        </div>
      </div>
      {!draft && !weather && (
        <div className="map-legend">
          <strong>MAP LEGEND</strong>
          <span>
            <i /> Registered field
          </span>
          <span>
            <i className="legend-selected" /> Selected field
          </span>
        </div>
      )}
      {draft && (
        <div className="map-draft-banner">
          <SquareDashed size={17} />
          <span>
            {activePoint != null
              ? "Click the map to move the selected point."
              : "Click on the map to add boundary points."}
            <small>
              {draft.length} points ·{" "}
              {draft.length >= 3 && !validBoundary(draft)
                ? "Fix overlapping points or edges"
                : `${acres(measure(draft))} ac`}
            </small>
          </span>
          <Button variant="primary" onClick={onSave} disabled={!validBoundary(draft)}>
            <Check size={15} /> Finish
          </Button>
        </div>
      )}
      {help && (
        <div className="map-help">
          Use + and − to zoom, then select the hand to pan. Use the boundary tool to add vertices.
          Scale is indicative.
        </div>
      )}
      <div className="map-scale">
        <span style={{ width: `${(scaleDistance / 3100) * 400 * zoom}%` }} />
        {scaleDistance} m
      </div>
      <span className="map-attribution">
        Illustrative {satellite ? "satellite imagery" : "street layer"}{" "}
        <button onClick={() => setHelp(!help)} aria-label="Map help">
          <CircleHelp size={12} />
        </button>
      </span>
    </div>
  );
}
