import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Layers,
  MapPin,
  PenLine,
  Ruler,
  Search,
  Shovel,
  Sprout,
  SquareDashed,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { acres, measure, demoRegion, regions, validBoundary } from "@/domain/data";
import type { Farmer, Field, Point, Region } from "@/domain/data";
import { Button, Chip, Demo, Empty, PageTitle, Stat } from "@/components/ui";
import { GeoCanvas } from "./GeoCanvas";
import { connected, polygon, request } from "@/domain/registry";

type Place = {
  id: number;
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

function coordinatePair(value: string): Point | undefined {
  const match = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) <= 85.05 && Math.abs(longitude) <= 180) return [longitude, latitude];
}

export function FarmMap({
  region,
  setRegion,
  fields,
  farmers,
  field,
  selectField,
  onProfile,
  onRegister,
  onSave,
  draft,
  setDraft,
  editing,
  setEditing,
  notify,
}: {
  region: Region;
  setRegion: (r: Region) => void;
  fields: Field[];
  farmers: Farmer[];
  field?: Field;
  selectField: (id: string) => void;
  onProfile: () => void;
  onRegister: () => void;
  onSave: () => void;
  draft: Point[] | null;
  setDraft: (v: Point[] | null) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  notify: (s: string) => void;
}) {
  const [satellite, setSatellite] = useState(true);
  const [layerMenu, setLayerMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [panel, setPanel] = useState(true);
  const [tool, setTool] = useState("pointer");
  const [full, setFull] = useState(false);
  const [view, setView] = useState(0);
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [target, setTarget] = useState<Point>();
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeStatus, setPlaceStatus] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const placeRequest = useRef(0);
  const map = demoRegion(region);
  const visible = fields.filter((f) => !region || f.region === region);
  const owner = farmers.find((f) => f.id === field?.farmerId);
  const total = visible.reduce((sum, f) => sum + f.acres, 0);
  const q = query.trim().toLowerCase();
  const locations = (connected ? [] : regions)
    .flatMap((r) => {
      const item = demoRegion(r);
      return [{ name: `${item.village}, ${item.district}`, sub: `${r} · ${item.center}`, r }];
    })
    .filter(
      (item) =>
        !q ||
        `${item.name} ${item.sub}`.toLowerCase().includes(q) ||
        (q === "kpk" && item.r !== "Punjab"),
    );
  const matches = q
    ? fields
        .filter((f) =>
          `${f.id} ${f.name} ${f.village} ${farmers.find((p) => p.id === f.farmerId)?.name}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 5)
    : [];
  const begin = () => {
    setEditing(false);
    setActivePoint(null);
    setDraft([]);
    setPanel(true);
    setTool("draw");
  };
  const closeDraft = () => {
    setDraft(null);
    setEditing(false);
    setActivePoint(null);
    setTool("pointer");
  };
  const pick = (id: string) => {
    setTarget(undefined);
    selectField(id);
    setPanel(true);
    setSearching(false);
  };
  const flyTo = (point: Point, name: string) => {
    setTarget(point);
    setQuery(name);
    setSearching(false);
  };
  async function findPlace() {
    const id = ++placeRequest.current;
    const point = coordinatePair(q);
    if (point) {
      flyTo(point, q);
      return;
    }
    setPlaces([]);
    setPlaceQuery(q);
    setPlaceStatus("Searching places…");
    try {
      const results = await request<Place[]>(`/locations?q=${encodeURIComponent(q)}`);
      if (placeRequest.current !== id) return;
      setPlaces(results);
      setPlaceStatus(
        results.length ? "" : "No places found. Try a nearby town or enter latitude, longitude.",
      );
    } catch (error) {
      if (placeRequest.current !== id) return;
      setPlaceStatus(error instanceof Error ? error.message : "Places could not be loaded.");
    }
  }
  const pickLocation = (r: Region, name: string) => {
    setRegion(r);
    setView(view + 1);
    setTool("pointer");
    setActivePoint(null);
    setQuery(name);
    setSearching(false);
    setPanel(true);
    notify(`Map centered on ${demoRegion(r).district}.`);
  };
  return (
    <>
      <PageTitle
        eyebrow="LAND & FIELD MANAGEMENT"
        title="Farm Map"
        description="Map agricultural land, manage field boundaries, and link parcels to farmer records."
      >
        <Button onClick={onRegister}>
          <UserRoundPlus size={16} /> Register Farmer
        </Button>
        <Button variant="primary" onClick={draft ? closeDraft : begin}>
          {draft ? <X size={16} /> : <SquareDashed size={17} />}{" "}
          {draft ? "Cancel Drawing" : "Draw Boundary"}
        </Button>
      </PageTitle>
      <div className="stats-grid map-stats">
        <Stat
          icon={<Layers size={21} />}
          value={visible.length}
          label="Mapped fields"
          note={connected ? region || "All locations" : `In ${map.district} district`}
        />
        <Stat
          icon={<Ruler size={21} />}
          value={
            <>
              {acres(total)} <small>acres</small>
            </>
          }
          label="Total mapped area"
          note={`${acres(total * 0.4046856)} hectares`}
        />
        <Stat
          icon={<Users size={21} />}
          value={farmers.filter((f) => !region || f.region === region).length}
          label="Registered farmers"
          note={connected ? region || "All locations" : "In the selected region"}
        />
      </div>
      <section className={`card map-workspace ${full ? "map-expanded" : ""}`}>
        <header className="map-toolbar">
          <div className="toolbar-title">
            <span className="mini-icon">
              <MapPin size={16} />
            </span>
            <div>
              <strong>Field workspace</strong>
              <small>
                {connected ? region || "All locations" : `${map.district}, ${map.short}`}
              </small>
            </div>
          </div>
          <div className="map-search-wrap">
            <form
              className="map-search"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches[0]) pick(matches[0].id);
                else if (connected && q.length >= 2) void findPlace();
                else if (locations[0]) pickLocation(locations[0].r, locations[0].name);
              }}
            >
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearching(true);
                }}
                onFocus={() => setSearching(true)}
                onBlur={(e) => {
                  if (!e.currentTarget.closest(".map-search-wrap")?.contains(e.relatedTarget))
                    setSearching(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearching(false);
                }}
                placeholder={
                  connected
                    ? "Search place, field, or latitude, longitude…"
                    : "Search village, district, or coordinates…"
                }
                aria-label={
                  connected
                    ? "Search place, field, or coordinates"
                    : "Search village, district, or coordinates"
                }
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear map search"
                  onClick={() => {
                    setQuery("");
                    setSearching(true);
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </form>
            {searching && (
              <div className="dropdown map-search-menu">
                {locations.map((l) => (
                  <button key={l.name} onClick={() => pickLocation(l.r, l.name)}>
                    <MapPin size={15} />
                    <span>
                      {l.name}
                      <small>{l.sub}</small>
                    </span>
                  </button>
                ))}
                {matches.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setQuery(f.name);
                      pick(f.id);
                    }}
                  >
                    <SquareDashed size={15} />
                    <span>
                      {f.name}
                      <small>
                        {f.id} · {f.village}
                      </small>
                    </span>
                  </button>
                ))}
                {connected && q.length >= 2 && (
                  <>
                    <button
                      type="button"
                      onClick={() => void findPlace()}
                      disabled={placeQuery === q && placeStatus === "Searching places…"}
                    >
                      <Search size={15} /> Search places or coordinates
                    </button>
                    {placeQuery === q && placeStatus && <p role="status">{placeStatus}</p>}
                    {placeQuery === q &&
                      places.map((place) => (
                        <button
                          type="button"
                          key={place.id}
                          onClick={() => flyTo([place.longitude, place.latitude], place.name)}
                        >
                          <MapPin size={15} />
                          <span>
                            {place.name}
                            <small>
                              {[place.region, place.country].filter(Boolean).join(", ")}
                            </small>
                          </span>
                        </button>
                      ))}
                  </>
                )}
                {!connected && !locations.length && !matches.length && (
                  <p>No matching locations in the demo.</p>
                )}
              </div>
            )}
          </div>
          {!connected && (
            <div className="layer-wrap">
              <Button onClick={() => setLayerMenu(!layerMenu)}>
                <Layers size={16} />
                <span>{satellite ? "Satellite" : "Standard"}</span>
                <ChevronDown size={13} />
              </Button>
              {layerMenu && (
                <div className="dropdown layer-menu">
                  {["Satellite", "Standard"].map((l) => (
                    <button
                      key={l}
                      onClick={() => {
                        setSatellite(l === "Satellite");
                        setLayerMenu(false);
                      }}
                    >
                      <Layers size={15} />
                      {l}
                      {(l === "Satellite") === satellite && (
                        <Check size={15} className="menu-check" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>
        <div className={`map-grid ${panel ? "" : "map-only"}`}>
          <GeoCanvas
            key={connected ? "live" : `${region}-${view}`}
            region={region}
            fields={visible}
            selected={field?.id}
            onSelect={pick}
            satellite={satellite}
            tool={tool}
            editing={editing}
            draft={draft ?? undefined}
            onDraftChange={setDraft}
            target={target}
            activePoint={activePoint}
            setActivePoint={setActivePoint}
            onPoint={(p) => {
              if (!draft) return;
              setDraft(
                activePoint == null
                  ? [...draft, p]
                  : draft.map((previous, i) => (i === activePoint ? p : previous)),
              );
              setActivePoint(null);
            }}
            onUndo={() => {
              if (draft) setDraft(draft.slice(0, -1));
              setActivePoint(null);
            }}
            onClear={() => {
              if (draft)
                setDraft(activePoint == null ? [] : draft.filter((_, i) => i !== activePoint));
              setActivePoint(null);
            }}
            onSave={onSave}
            onTool={(t) => {
              if (t === "draw") {
                if (!draft) begin();
              } else if (!draft) setTool(t);
            }}
            full={full}
            setFull={setFull}
          />
          {panel && (
            <aside className="field-panel">
              <div className="field-panel-head">
                <span>
                  <MapPin size={15} /> {draft ? "BOUNDARY WORKSPACE" : "FIELD DETAILS"}
                </span>
                <button
                  className="bare-button"
                  onClick={() => setPanel(false)}
                  title="Hide field details"
                  aria-label="Hide field details"
                >
                  <X size={17} />
                </button>
              </div>
              {draft ? (
                <div className="panel-content drafting">
                  <Chip tone="amber" dot>
                    {editing ? "Editing boundary" : "Drawing boundary"}
                  </Chip>
                  <h2>{editing && field ? field.name : "New farm boundary"}</h2>
                  <p>
                    {connected
                      ? editing
                        ? "Drag a vertex to move it or select a midpoint to add a vertex."
                        : "Select at least three points, then click the first point to close the boundary."
                      : "Select at least three points on the map. To move a point, select it and click its new position."}
                  </p>
                  {!connected && (
                    <div className="area-box">
                      <span className="mini-icon">
                        <Ruler size={17} />
                      </span>
                      <div>
                        <small>CALCULATED AREA</small>
                        <strong>
                          {acres(measure(draft))} <em>acres</em>
                        </strong>
                        <span>{acres(measure(draft) * 0.4046856)} hectares</span>
                      </div>
                    </div>
                  )}
                  <div className="field-actions">
                    <Button
                      variant="primary"
                      onClick={onSave}
                      disabled={connected ? draft.length < 3 : !validBoundary(draft)}
                    >
                      <Check size={16} /> Save Farm
                    </Button>
                    <Button onClick={closeDraft}>Discard changes</Button>
                  </div>
                </div>
              ) : field ? (
                <div className="panel-content">
                  <div className="field-identity">
                    <div className="field-id">{field.id}</div>
                    <h2>{owner?.name ?? field.name}</h2>
                    <p>{field.name}</p>
                    <Chip tone="green" dot>
                      Registered
                    </Chip>
                  </div>
                  <div className="area-box">
                    <span className="mini-icon">
                      <Ruler size={17} />
                    </span>
                    <div>
                      <small>MAPPED AREA</small>
                      <strong>
                        {acres(field.acres)} <em>acres</em>
                      </strong>
                      <span>{acres(field.acres * 0.4046856)} hectares</span>
                    </div>
                  </div>
                  <dl className="field-facts">
                    <div>
                      <dt>
                        <MapPin size={14} /> Location
                      </dt>
                      <dd>
                        {connected
                          ? field.region
                          : `${map.district}, ${region === "Punjab" ? "Punjab" : "KP"}`}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Sprout size={15} /> Crop
                      </dt>
                      <dd>{field.crop}</dd>
                    </div>
                    <div>
                      <dt>
                        <Shovel size={14} /> Soil type
                      </dt>
                      <dd>{field.soil}</dd>
                    </div>
                    <div>
                      <dt>
                        <Layers size={14} /> Irrigation
                      </dt>
                      <dd>{field.source}</dd>
                    </div>
                  </dl>
                  <div className="field-actions">
                    <Button variant="primary" onClick={onProfile}>
                      View Farmer Profile <ArrowUpRight size={15} />
                    </Button>
                    <Button
                      onClick={() => {
                        setActivePoint(null);
                        setEditing(true);
                        setDraft([...field.points]);
                      }}
                    >
                      <PenLine size={15} /> Edit Boundary
                    </Button>
                  </div>
                </div>
              ) : (
                <Empty
                  title="No field selected"
                  text="Select a field on the map or draw a new boundary."
                />
              )}
            </aside>
          )}
        </div>
        <footer className="map-footer">
          <span>
            <i /> {visible.length} {visible.length === 1 ? "field" : "fields"} visible{" "}
            <span className="footer-divider" /> <Crosshair size={14} />
            {!connected && <span className="coordinate">{map.center}</span>}
          </span>
          <span>
            {!panel && (
              <button className="text-action" onClick={() => setPanel(true)}>
                Show details
              </button>
            )}
            {!connected && <Demo>Demo workspace</Demo>}
          </span>
        </footer>
      </section>
      <div className="after-map">
        <span>
          <CircleHelp size={15} />{" "}
          {connected
            ? "Mapped boundaries are officer records."
            : "Boundaries are for demonstration and do not represent official land records."}
        </span>
        <button
          className="text-action"
          onClick={() => {
            const blob = new Blob(
              [
                JSON.stringify(
                  connected
                    ? {
                        type: "FeatureCollection",
                        features: visible.map(({ id, name, acres, points }) => ({
                          type: "Feature",
                          geometry: polygon(points),
                          properties: { id, name, acres },
                        })),
                      }
                    : visible.map(({ id, name, acres, points }) => ({
                        id,
                        name,
                        acres,
                        demoPlanarCoordinates: points,
                      })),
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = connected
              ? "aquaproof-boundaries.geojson"
              : "aquaproof-demo-boundaries.json";
            a.click();
            URL.revokeObjectURL(url);
            notify("Boundary file exported.");
          }}
        >
          <ArrowDownToLine size={14} /> Export boundaries
        </button>
      </div>
    </>
  );
}
