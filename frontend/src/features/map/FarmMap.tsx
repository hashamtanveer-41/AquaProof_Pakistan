import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CircleHelp,
  Crosshair,
  Layers,
  MapPin,
  Maximize,
  PenLine,
  Ruler,
  Search,
  Shovel,
  SquareDashed,
  Trash2,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { acres, type Farmer, type Field, type Point, type Region } from "@/domain/data";
import { Button, Chip, Empty, PageTitle, Stat } from "@/components/ui";
import { request } from "@/domain/registry";
import { formatWeatherTime } from "@/domain/weather";
import { type ArcGISConfig, type Basemap } from "./basemap";
import { exportBoundaries, readBoundary } from "./boundaryFile";
import { GeoCanvas } from "./GeoCanvas";
import {
  areaUnits,
  cropStageStyles,
  irrigationStyle,
  irrigationStyles,
  previewArea,
  validMapPoint,
  validParcel,
} from "./parcel";

type Place = {
  id: number | string;
  name: string;
  region?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
};
type Suggestion = { text: string; magic_key: string };
type PlaceResults = { results: Place[]; source: string; fallback_reason?: string };
type MapWeather = { temperature_c: number; source: string; time: string };

function coordinatePair(value: string): Point | undefined {
  const match = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/.exec(value);
  if (match) return [Number(match[2]), Number(match[1])];
}

function ParcelArea({ value, estimate = false }: { value: number; estimate?: boolean }) {
  const [[acreValue, acreLabel], ...units] = areaUnits(value);
  return (
    <div className="area-box">
      <span className="mini-icon">
        <Ruler size={17} />
      </span>
      <div>
        <small>{estimate ? "ESTIMATED AREA" : "SAVED AREA"}</small>
        <strong>
          {acres(acreValue)} <em>{acreLabel}</em>
        </strong>
        <span>{units.map(([amount, unit]) => acres(amount) + " " + unit).join(" · ")}</span>
      </div>
    </div>
  );
}

export function FarmMap({
  region,
  fields,
  farmers,
  field,
  focusField,
  selectField,
  onProfile,
  onWeather,
  onIrrigation,
  onRegister,
  onSave,
  onDelete,
  draft,
  setDraft,
  editing,
  setEditing,
  notify,
  registryAvailable,
}: {
  region: Region;
  fields: Field[];
  farmers: Farmer[];
  field?: Field;
  focusField: boolean;
  selectField: (id: string) => void;
  onProfile: () => void;
  onWeather: () => void;
  onIrrigation: () => void;
  onRegister: () => void;
  onSave: () => void;
  onDelete: (id: string, permanentName?: string) => Promise<boolean>;
  draft: Point[] | null;
  setDraft: (value: Point[] | null) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  notify: (message: string) => void;
  registryAvailable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [panel, setPanel] = useState(true);
  const [full, setFull] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("street");
  const [arcgis, setArcgis] = useState<ArcGISConfig>();
  const [openMap, setOpenMap] = useState(true);
  const arcgisConfigured = Boolean(arcgis?.browser_token || arcgis?.server_basemaps);
  const viewOnlyArcgis = arcgisConfigured && !arcgis?.digitization_authorized;
  const useOpenMap = openMap || (draft !== null && (viewOnlyArcgis || basemap !== "street"));
  const arcgisToken = useOpenMap ? null : arcgis?.browser_token;
  const arcgisServer = !useOpenMap && Boolean(arcgis?.server_basemaps);
  const [imageryError, setImageryError] = useState("");
  const [ready, setReady] = useState(false);
  const [resetView, setResetView] = useState(0);
  const [target, setTarget] = useState<Point>();
  const [locationLabel, setLocationLabel] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [placeStatus, setPlaceStatus] = useState("");
  const placeRequest = useRef<AbortController>(null);
  const [preview, setPreview] = useState<Point[]>([]);
  const [clearDraft, setClearDraft] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [colorMode, setColorMode] = useState<"irrigation" | "crop">("irrigation");
  const [showWeather, setShowWeather] = useState(false);
  const [weatherReading, setWeatherReading] = useState<MapWeather>();
  const [weatherStatus, setWeatherStatus] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const importing = useRef(false);

  useEffect(() => () => placeRequest.current?.abort(), []);
  const fieldId = field?.id;
  useEffect(() => {
    setWeatherReading(undefined);
    setWeatherStatus("");
    if (!showWeather || !fieldId) return;
    const controller = new AbortController();
    let pending = false;
    function load() {
      if (pending) return;
      pending = true;
      request<MapWeather>(
        `/fields/${encodeURIComponent(fieldId!)}/weather/current`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((reading) => {
          if (!controller.signal.aborted) {
            setWeatherReading(reading);
            setWeatherStatus("");
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setWeatherReading(undefined);
            setWeatherStatus(error instanceof Error ? error.message : "Field weather unavailable.");
          }
        })
        .finally(() => {
          pending = false;
        });
    }
    load();
    const timer = window.setInterval(load, 180_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [showWeather, fieldId]);
  useEffect(() => {
    if (!registryAvailable) return;
    const controller = new AbortController();
    request<ArcGISConfig>("/map/config", "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setArcgis(data);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setImageryError("Map provider configuration is unavailable.");
      });
    return () => controller.abort();
  }, [registryAvailable]);
  useEffect(() => {
    if (!full) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setFull(false);
    };
    window.addEventListener("keydown", exit);
    return () => {
      window.removeEventListener("keydown", exit);
      document.body.style.overflow = previousOverflow;
    };
  }, [full]);

  const visible = useMemo(
    () => (region ? fields.filter((item) => item.region === region) : fields),
    [fields, region],
  );
  const owner = farmers.find((person) => person.id === field?.farmerId);
  const farmerById = useMemo(
    () => new Map(farmers.map((farmer) => [farmer.id, farmer])),
    [farmers],
  );
  const total = useMemo(() => visible.reduce((sum, item) => sum + item.acres, 0), [visible]);
  const q = query.trim();
  const displayedBasemap = useOpenMap ? "street" : basemap;
  const currentArea = previewArea(preview.length ? preview : (draft ?? []));
  const weatherPoint =
    showWeather && weatherReading && field?.longitude != null && field.latitude != null
      ? {
          point: [field.longitude, field.latitude] as Point,
          temperature_c: weatherReading.temperature_c,
        }
      : undefined;
  const canSave = Boolean(ready && registryAvailable && draft && validParcel(draft));
  const matches = q
    ? fields
        .filter((item) => {
          const farmer = farmerById.get(item.farmerId);
          return [
            item.id,
            item.name,
            item.village,
            item.region,
            farmer?.district,
            farmer?.tehsil,
            farmer?.name,
          ].some((label) => label?.toLowerCase().includes(q.toLowerCase()));
        })
        .slice(0, 5)
    : [];

  function resetSearch() {
    placeRequest.current?.abort();
    setPlaces([]);
    setSuggestions([]);
    setPlaceStatus("");
  }

  function pick(id: string) {
    resetSearch();
    setTarget(undefined);
    setLocationLabel("");
    selectField(id);
    setPanel(true);
    setSearching(false);
  }

  function centerOn(point: Point, label: string) {
    setTarget(point);
    setLocationLabel(label);
    setSearching(false);
  }

  useEffect(() => {
    if (!searching || draft || q.length < 3 || coordinatePair(q)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      request<Suggestion[]>(
        `/map/suggest?q=${encodeURIComponent(q)}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((items) => {
          if (!controller.signal.aborted) setSuggestions(items);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, searching, draft]);

  async function findPlace(suggestion?: Suggestion) {
    const term = suggestion?.text ?? q;
    if (term.length < 2 || draft) return;
    resetSearch();
    const point = coordinatePair(q);
    if (point && !validMapPoint(point)) {
      setPlaceStatus("Coordinates are outside the map’s latitude or longitude range.");
      return;
    }
    if (point) {
      centerOn(point, q);
      const controller = new AbortController();
      placeRequest.current = controller;
      request<{ name: string }>(
        `/map/reverse?latitude=${point[1]}&longitude=${point[0]}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then(({ name }) => {
          if (!controller.signal.aborted) setLocationLabel(name);
        })
        .catch(() => {
          /* Keep the coordinates as the location label. */
        });
      return;
    }
    const controller = new AbortController();
    placeRequest.current = controller;
    try {
      setPlaceStatus("Searching places…");
      const params = new URLSearchParams({ q: term });
      if (suggestion) params.set("magic_key", suggestion.magic_key);
      const { results, source } = await request<PlaceResults>(
        `/map/search?${params}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const usable = results.filter(({ longitude, latitude }) =>
        validMapPoint([longitude, latitude]),
      );
      if (suggestion && usable[0]) {
        setQuery(usable[0].name);
        centerOn([usable[0].longitude, usable[0].latitude], usable[0].name);
        return;
      }
      setPlaces(usable);
      setPlaceStatus(
        usable.length
          ? `Results from ${source}`
          : "No places found. Try a nearby town or enter coordinates.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setPlaceStatus(error instanceof Error ? error.message : "Location lookup failed.");
    }
  }

  async function importBoundary(file: File) {
    if (importing.current || draft || !ready) return;
    importing.current = true;
    try {
      const points = await readBoundary(file);
      startDraft(points, false);
      setTarget(points[0]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Boundary import failed.");
    } finally {
      importing.current = false;
    }
  }

  function startDraft(points: Point[] = [], editExisting = points.length > 0) {
    if (!ready) return;
    setPreview([]);
    resetSearch();
    if (points.length) {
      setTarget(undefined);
      setLocationLabel("");
    }
    setEditing(editExisting);
    setDraft(points);
    setPanel(true);
    setSearching(false);
  }

  function discardDraft() {
    setPreview([]);
    setEditing(false);
    setDraft(null);
  }

  async function removeField(item: Field, permanent = false) {
    if (
      !permanent &&
      !window.confirm(
        'Remove "' +
          item.name +
          '" from the active registry and map? Its history will be retained.',
      )
    )
      return;
    setDeleting(true);
    try {
      await onDelete(item.id, permanent ? item.name : undefined);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="LAND & FIELD MANAGEMENT"
        title="Farm Map"
        description="Map agricultural land, manage field boundaries, and link parcels to farmer records."
      >
        <Button onClick={onRegister} disabled={!registryAvailable}>
          <UserRoundPlus size={16} /> Register Farmer
        </Button>
        <Button
          variant="primary"
          disabled={!draft && !ready}
          onClick={draft ? discardDraft : () => startDraft()}
        >
          {draft ? <X size={16} /> : <SquareDashed size={17} />}
          {draft ? "Cancel Drawing" : "Draw Boundary"}
        </Button>
      </PageTitle>
      <div className="stats-grid map-stats">
        <Stat
          icon={<Layers size={21} />}
          value={registryAvailable ? visible.length : "—"}
          label="Mapped fields"
          note={region || "All locations"}
        />
        <Stat
          icon={<Ruler size={21} />}
          value={
            registryAvailable ? (
              <>
                {acres(total)} <small>acres</small>
              </>
            ) : (
              "—"
            )
          }
          label="Total mapped area"
        />
        <Stat
          icon={<Users size={21} />}
          value={
            registryAvailable
              ? farmers.filter((person) => !region || person.region === region).length
              : "—"
          }
          label="Registered farmers"
        />
      </div>
      <section className={full ? "card map-workspace map-expanded" : "card map-workspace"}>
        <header className="map-toolbar">
          <div className="toolbar-title">
            <span className="mini-icon">
              <MapPin size={16} />
            </span>
            <div>
              <strong>Field workspace</strong>
              <small>{region || "Pakistan"}</small>
            </div>
          </div>
          <div className="map-search-wrap">
            <form
              className="map-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (matches[0]) {
                  setQuery(matches[0].name);
                  pick(matches[0].id);
                } else void findPlace();
              }}
            >
              <Search size={16} />
              <input
                value={query}
                disabled={Boolean(draft)}
                onChange={(event) => {
                  resetSearch();
                  setQuery(event.target.value);
                  setSearching(true);
                }}
                onFocus={() => setSearching(true)}
                onBlur={(event) => {
                  if (
                    !event.currentTarget.closest(".map-search-wrap")?.contains(event.relatedTarget)
                  )
                    setSearching(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearching(false);
                }}
                placeholder="Search places, fields, or latitude, longitude…"
                aria-label="Search places, registered fields or coordinates"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear map search"
                  onClick={() => {
                    resetSearch();
                    setQuery("");
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </form>
            {searching && q.length >= 2 && !draft && (
              <div className="dropdown map-search-menu">
                {matches.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setQuery(item.name);
                      pick(item.id);
                    }}
                  >
                    <SquareDashed size={15} />
                    <span>
                      {item.name}
                      <small>
                        {item.id} · {item.village}
                      </small>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void findPlace()}
                  disabled={placeStatus === "Searching places…"}
                >
                  <Search size={15} /> Search places or coordinates
                </button>
                {placeStatus && <p role="status">{placeStatus}</p>}
                {!places.length &&
                  suggestions.map((suggestion) => (
                    <button
                      key={suggestion.magic_key}
                      type="button"
                      onClick={() => void findPlace(suggestion)}
                    >
                      <MapPin size={15} /> {suggestion.text}
                    </button>
                  ))}
                {places.map((place) => (
                  <button
                    type="button"
                    key={place.id}
                    onClick={() => {
                      setQuery(place.name);
                      centerOn([place.longitude, place.latitude], place.name);
                    }}
                  >
                    <MapPin size={15} />
                    <span>
                      {place.name}
                      <small>{[place.region, place.country].filter(Boolean).join(", ")}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="map-actions">
            <select
              className="basemap-select"
              aria-label="Field color"
              value={colorMode}
              onChange={(event) =>
                setColorMode(event.target.value === "crop" ? "crop" : "irrigation")
              }
            >
              <option value="irrigation">Irrigation status</option>
              <option value="crop">Crop stage</option>
            </select>
            {full && (
              <Button
                variant="primary"
                disabled={!draft && !ready}
                onClick={draft ? discardDraft : () => startDraft()}
              >
                {draft ? <X size={16} /> : <SquareDashed size={16} />}
                {draft ? "Cancel Drawing" : "Draw Boundary"}
              </Button>
            )}
            <select
              className="basemap-select"
              aria-label="Basemap"
              value={useOpenMap && arcgisConfigured ? "open" : displayedBasemap}
              disabled={draft !== null}
              onChange={(event) => {
                setImageryError("");
                const choice = event.target.value;
                setOpenMap(choice === "open");
                setBasemap(choice === "open" ? "street" : (choice as Basemap));
              }}
            >
              <option value="street">{arcgisConfigured ? "ArcGIS Street" : "Street"}</option>
              {arcgisConfigured && <option value="open">Open street</option>}
              {arcgisConfigured && <option value="satellite">ArcGIS Satellite (view only)</option>}
              {arcgisConfigured && <option value="hybrid">ArcGIS Hybrid (view only)</option>}
            </select>
            <button
              type="button"
              className="bare-button"
              aria-label="View Pakistan"
              title="View Pakistan"
              disabled={Boolean(draft)}
              onClick={() => {
                setTarget(undefined);
                setLocationLabel("");
                setResetView((current) => current + 1);
              }}
            >
              <Crosshair size={16} />
            </button>
            <button
              type="button"
              className="bare-button"
              aria-label={full ? "Exit expanded map" : "Expand map"}
              aria-pressed={full}
              title={full ? "Exit fullscreen map" : "Fullscreen map"}
              onClick={() => setFull(!full)}
            >
              {full ? <X size={17} /> : <Maximize size={17} />}
            </button>
          </div>
        </header>
        {imageryError && (
          <div className="map-imagery-notice" role="alert">
            {imageryError}
          </div>
        )}
        {draft === null && (viewOnlyArcgis || basemap !== "street") && !useOpenMap && (
          <div className="map-imagery-notice" role="status">
            Drawing and editing use the street map.
          </div>
        )}
        <div className={panel ? "map-grid" : "map-grid map-only"}>
          <GeoCanvas
            fields={visible}
            selected={editing || !draft ? field?.id : undefined}
            focusField={focusField}
            onSelect={pick}
            draft={draft ?? undefined}
            onDraftChange={setDraft}
            onPreview={setPreview}
            onReady={setReady}
            target={target}
            resetView={resetView}
            clearDraft={clearDraft}
            basemap={displayedBasemap}
            arcgisToken={arcgisToken}
            arcgisServer={arcgisServer}
            colorMode={colorMode}
            weatherPoint={weatherPoint}
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
                  {!registryAvailable && (
                    <p role="status">
                      You can mark boundary points now. Saving is available when the registry
                      reconnects.
                    </p>
                  )}
                  <p>
                    {editing
                      ? "Drag a vertex to move it or select a midpoint to add a vertex. Select a vertex and press Delete to remove it."
                      : "Select at least three points, then click the first point to close the boundary."}
                  </p>
                  {currentArea > 0 && <ParcelArea value={currentArea} estimate />}
                  <p>Undo with Ctrl or Command + Z. Add Shift to redo.</p>
                  {draft.length >= 3 && !validParcel(draft) && (
                    <p role="alert">
                      The boundary must enclose an area without duplicate vertices.
                    </p>
                  )}
                  <div className="field-actions">
                    <Button variant="primary" onClick={onSave} disabled={!canSave}>
                      <Check size={16} /> Save Farm
                    </Button>
                    <Button
                      onClick={() => {
                        setDraft([]);
                        setPreview([]);
                        setClearDraft((count) => count + 1);
                      }}
                    >
                      Clear drawing
                    </Button>
                    <Button onClick={discardDraft}>Discard changes</Button>
                    {editing && field && (
                      <Button disabled={deleting} onClick={() => void removeField(field)}>
                        <Trash2 size={15} /> Archive field
                      </Button>
                    )}
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
                  <ParcelArea value={field.acres} />
                  <dl className="field-facts">
                    <div>
                      <dt>
                        <MapPin size={14} /> Location
                      </dt>
                      <dd>
                        {[field.village, owner?.tehsil, owner?.district, field.region]
                          .filter(Boolean)
                          .join(", ")}
                      </dd>
                    </div>
                    {field.latitude != null && field.longitude != null && (
                      <div>
                        <dt>Coordinates</dt>
                        <dd>
                          {field.latitude.toFixed(6)}, {field.longitude.toFixed(6)}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Crop</dt>
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
                    <div>
                      <dt>Status</dt>
                      <dd className="parcel-status">
                        <i style={{ background: irrigationStyle(field).color }} />
                        {irrigationStyle(field).label}
                      </dd>
                    </div>
                  </dl>
                  <div className="field-actions">
                    <Button variant="primary" onClick={onProfile}>
                      View Farmer Profile <ArrowUpRight size={15} />
                    </Button>
                    <Button onClick={onWeather}>Field weather</Button>
                    <Button onClick={() => setShowWeather((value) => !value)}>
                      {showWeather ? "Hide weather marker" : "Show weather marker"}
                    </Button>
                    <Button onClick={onIrrigation}>Irrigation plan</Button>
                    <Button
                      disabled={!ready || deleting}
                      onClick={() => startDraft([...field.points])}
                    >
                      <PenLine size={15} /> Edit Boundary
                    </Button>
                    <Button disabled={deleting} onClick={() => void removeField(field)}>
                      <Trash2 size={15} /> Archive field
                    </Button>
                    <Button disabled={deleting} onClick={() => void removeField(field, true)}>
                      Delete permanently
                    </Button>
                  </div>
                  {showWeather && (
                    <p role={weatherStatus ? "alert" : "status"}>
                      {weatherStatus ||
                        (weatherReading
                          ? `${weatherReading.temperature_c.toFixed(1)} °C · ${weatherReading.source} · ${formatWeatherTime(weatherReading.time)} PKT`
                          : "Loading field weather…")}
                    </p>
                  )}
                </div>
              ) : (
                <Empty
                  title="No field selected"
                  text="Search a place or select a registered field on the map."
                />
              )}
            </aside>
          )}
        </div>
        <footer className="map-footer">
          <div
            className="parcel-legend"
            aria-label={colorMode === "crop" ? "Crop stage legend" : "Irrigation status legend"}
          >
            {(colorMode === "crop" ? cropStageStyles : Object.values(irrigationStyles)).map(
              ({ color, label }) => (
                <span className="parcel-status" key={label}>
                  <i style={{ background: color }} />
                  {label}
                </span>
              ),
            )}
          </div>
          {locationLabel && <span>{locationLabel}</span>}
          {registryAvailable && (
            <span>
              {visible.length} {visible.length === 1 ? "field" : "fields"} visible
            </span>
          )}
          {!panel && (
            <button className="text-action" onClick={() => setPanel(true)}>
              Show details
            </button>
          )}
        </footer>
      </section>
      <div className="after-map">
        <span>
          <CircleHelp size={15} /> Mapped boundaries are officer records.
        </span>
        <input
          ref={importInput}
          type="file"
          accept=".geojson,.json,.kml"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importBoundary(file);
          }}
        />
        <Button disabled={!ready || Boolean(draft)} onClick={() => importInput.current?.click()}>
          Import boundary
        </Button>
        <Button disabled={!visible.length} onClick={() => exportBoundaries(visible, "geojson")}>
          <ArrowDownToLine size={14} /> GeoJSON
        </Button>
        <Button disabled={!visible.length} onClick={() => exportBoundaries(visible, "kml")}>
          <ArrowDownToLine size={14} /> KML
        </Button>
      </div>
    </>
  );
}
