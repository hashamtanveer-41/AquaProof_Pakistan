import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Command,
  Droplets,
  Globe2,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sprout,
  Users,
  Waves,
  X,
} from "lucide-react";
import type { Farmer, Field, Page, Point, Region } from "@/domain/data";
import { Brand, Card, Chip, PageTitle } from "@/components/ui";
import { FarmMap } from "@/features/map/FarmMap";
import { RegisterModal, type Registration } from "@/features/registration/RegisterModal";
import { ServiceHealth } from "@/pages/ServiceHealth";
import { WhatsAppSendingPhone } from "@/pages/WhatsAppSendingPhone";
import {
  archiveField,
  ApiError,
  loadRegistry,
  polygon,
  permanentlyDeleteField,
  registerFarmer,
  request,
  updateBoundary,
} from "@/domain/registry";

const Crops = lazy(() => import("@/pages/Crops"));
const LiveOverview = lazy(() => import("@/pages/LiveOverview"));
const Profile = lazy(() => import("@/pages/Profile"));
const Registry = lazy(() => import("@/pages/Registry"));
const Weather = lazy(() => import("@/pages/Weather"));
const FieldIntelligence = lazy(() => import("@/pages/FieldIntelligence"));
const LiveAdvisory = lazy(() => import("@/pages/LiveAdvisory"));
const WhatsAppConversations = lazy(() => import("@/pages/WhatsAppConversations"));
const FieldHistory = lazy(() => import("@/pages/FieldHistory"));

const navigation = [
  {
    title: "WORKSPACE",
    items: [
      { id: "overview", label: "Overview Dashboard", icon: LayoutDashboard },
      { id: "map", label: "Farm Map", icon: MapIcon },
      { id: "registry", label: "Farmers Registry", icon: Users },
      { id: "crops", label: "Crop Monitoring", icon: Sprout },
    ],
  },
  {
    title: "INTELLIGENCE",
    items: [
      { id: "irrigation", label: "Irrigation Intelligence", icon: Droplets },
      { id: "weather", label: "Weather & Canal Data", icon: Waves },
      { id: "advisory", label: "AI Advisory Center", icon: Sparkles },
      { id: "conversations", label: "WhatsApp Conversations", icon: MessagesSquare },
    ],
  },
  {
    title: "ADMINISTRATION",
    items: [
      { id: "reports", label: "Reports & History", icon: ClipboardList },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

export default function App() {
  const [page, setPage] = useState<Page>("map");
  const [region, setRegion] = useState<Region>("");
  const [fields, setFields] = useState<Field[]>([]);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [fieldId, setFieldId] = useState("");
  const [farmerId, setFarmerId] = useState("");
  const [registryStatus, setRegistryStatus] = useState("Loading registry…");
  const [officerLogin, setOfficerLogin] = useState(false);
  const [officerSession, setOfficerSession] = useState(false);
  const [officerBusy, setOfficerBusy] = useState(false);
  const [officerError, setOfficerError] = useState("");
  const [registryAttempt, setRegistryAttempt] = useState(0);
  const registryWrite = useRef(false);
  const registryVersion = useRef(0);
  const [menu, setMenu] = useState("");
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftOwner, setDraftOwner] = useState<string>();
  const [registration, setRegistration] = useState<Registration>();
  const [toast, setToast] = useState("");
  const [rtl, setRtl] = useState(false);
  const [large, setLarge] = useState(false);
  const timeout = useRef<number>(undefined);
  const search = useRef<HTMLInputElement>(null);
  const field = fields.find((f) => f.id === fieldId);
  const farmer = farmers.find((f) => f.id === farmerId);
  const visibleFields = fields.filter((f) => !region || f.region === region);
  const mapField = visibleFields.find((f) => f.id === fieldId) ?? visibleFields[0];
  const locationName = region || "All locations";
  const regionOptions = ["", ...new Set(farmers.map((person) => person.region).sort())];
  const title =
    page === "profile"
      ? "Farmer Profile"
      : (navigation.flatMap((g) => [...g.items]).find((i) => i.id === page)?.label ?? "Farm Map");
  useEffect(() => {
    const controller = new AbortController();
    const version = registryVersion.current;
    loadRegistry(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (registryVersion.current !== version) {
          setRegistryAttempt((attempt) => attempt + 1);
          return;
        }
        setFarmers(data.farmers);
        setFields(data.fields);
        setOfficerLogin(false);
        setOfficerSession(true);
        setRegistryStatus("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const unauthorized = error instanceof ApiError && error.status === 401;
        const databaseUnavailable = error instanceof ApiError && error.status === 503;
        setOfficerLogin(unauthorized);
        if (unauthorized || databaseUnavailable) setOfficerSession(databaseUnavailable);
        setRegistryStatus(
          unauthorized
            ? "Officer sign-in required."
            : databaseUnavailable
              ? "The registry database is unavailable. Boundary saving and records need PostgreSQL with PostGIS."
              : "The registry could not connect to the API.",
        );
      });
    return () => {
      controller.abort();
    };
  }, [registryAttempt]);

  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") setMenu("");
    }
    document.addEventListener("keydown", shortcuts);
    return () => {
      document.removeEventListener("keydown", shortcuts);
      window.clearTimeout(timeout.current);
    };
  }, []);
  const notify = (message: string) => {
    setToast(message);
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => setToast(""), 3500);
  };
  const refreshRegistry = () => {
    setMenu("");
    setFields([]);
    setFarmers([]);
    setRegistryStatus("Loading registry…");
    setRegistryAttempt((attempt) => attempt + 1);
  };
  const go = (next: Page) => {
    if (page !== next) {
      setMenu("");
      setDraft(null);
      setEditing(false);
      setDraftOwner(undefined);
      setPage(next);
      refreshRegistry();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    setMobile(false);
  };
  const openField = (id: string, next?: Page) => {
    const found = fields.find((f) => f.id === id);
    if (!found) return;
    if (next) go(next);
    if (found.region !== region || fieldId !== id) {
      setDraft(null);
      setDraftOwner(undefined);
      setEditing(false);
    }
    setFieldId(id);
    setFarmerId(found.farmerId);
    if (region && found.region !== region) setRegion(found.region);
    setMenu("");
  };
  const pickRegion = (r: Region) => {
    if (r !== region) {
      setRegion(r);
      setDraft(null);
      setEditing(false);
      setDraftOwner(undefined);
      const f = fields.find((f) => !r || f.region === r);
      if (f) {
        setFieldId(f.id);
        setFarmerId(f.farmerId);
      }
    }
    setMenu("");
  };
  const openFarmer = (id: string, next?: Page) => {
    const found = farmers.find((f) => f.id === id);
    if (!found) return;
    if (next) go(next);
    setFarmerId(id);
    if (region && found.region !== region) setRegion(found.region);
    setFieldId(fields.find((f) => f.farmerId === id)?.id ?? "");
    setMenu("");
  };
  const replaceField = (saved: Field) => {
    registryVersion.current += 1;
    setFields((existing) =>
      existing.some((field) => field.id === saved.id)
        ? existing.map((field) => (field.id === saved.id ? saved : field))
        : [...existing, saved],
    );
  };
  const saveBoundary = async () => {
    if (!draft || draft.length < 3) return;
    if (!editing || !mapField) {
      setRegistration({ points: draft, owner: draftOwner });
      return;
    }
    if (registryWrite.current) return;
    registryWrite.current = true;
    try {
      replaceField(await updateBoundary(mapField.id, draft));
      setDraft((current) => (current === draft ? null : current));
      notify("Boundary saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The boundary could not be saved.");
    } finally {
      registryWrite.current = false;
    }
  };
  const deleteField = async (id: string, permanentName?: string) => {
    if (registryWrite.current) return false;
    if (
      permanentName &&
      window.prompt(
        `Permanently delete "${permanentName}" and its saved AquaProof history? The farmer and other fields are kept. Type DELETE to confirm.`,
      ) !== "DELETE"
    )
      return false;
    registryWrite.current = true;
    try {
      if (permanentName) await permanentlyDeleteField(id);
      else await archiveField(id);
      registryVersion.current += 1;
      setFields((existing) => existing.filter((item) => item.id !== id));
      setFieldId((existing) => (existing === id ? "" : existing));
      setDraft(null);
      setEditing(false);
      notify(permanentName ? "Field and its saved history deleted." : "Field archived.");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "The field could not be removed.");
      return false;
    } finally {
      registryWrite.current = false;
    }
  };
  const saveRegistration = async (
    owner: Farmer,
    detail?: Pick<Field, "name" | "crop" | "soil" | "source">,
  ) => {
    const points = registration?.points;
    const saved = await registerFarmer(
      owner,
      points && detail ? { ...detail, boundary: polygon(points) } : undefined,
    );
    registryVersion.current += 1;
    setFarmers((existing) =>
      existing.some((farmer) => farmer.id === saved.farmer.id)
        ? existing
        : [...existing, saved.farmer],
    );
    if (saved.field) replaceField(saved.field);
    go("profile");
    setFarmerId(saved.farmer.id);
    if (region && saved.farmer.region !== region) setRegion(saved.farmer.region);
    setFieldId(saved.field?.id ?? "");
    setRegistration(undefined);
    notify(saved.field ? "Farm saved and linked to the farmer profile." : "Farmer registered.");
  };
  const ql = q.trim().toLowerCase();
  const farmResults = ql
    ? fields
        .filter((f) => `${f.id} ${f.name} ${f.crop} ${f.region}`.toLowerCase().includes(ql))
        .slice(0, 5)
    : [];
  const farmerResults = ql
    ? farmers.filter((f) => `${f.name} ${f.id}`.toLowerCase().includes(ql)).slice(0, 4)
    : [];
  function toggleMenu(id: string) {
    setMenu((old) => (old === id ? "" : id));
  }
  return (
    <div className={`app ${large ? "large-text" : ""}`} dir={rtl ? "rtl" : "ltr"}>
      {mobile && (
        <button
          className="sidebar-overlay"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <button
          className="brand-button"
          aria-label="AquaProof Pakistan Farm Map"
          onClick={() => go("map")}
        >
          <Brand />
        </button>
        <div className="sidebar-nav">
          {navigation.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-caption">{group.title}</div>
              {group.items.map((item) => {
                const active = page === item.id || (page === "profile" && item.id === "registry");
                return (
                  <button
                    className={`nav-item ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    key={item.id}
                    onClick={() => go(item.id)}
                  >
                    <item.icon size={18} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {active && <i />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item support" onClick={() => go("settings")}>
            <CircleHelp size={18} />
            <span>Help & Support</span>
          </button>
          <div className="department">
            <span>
              <Building2 size={17} />
            </span>
            <div>
              <strong>Agriculture Department</strong>
              <small>GOVERNMENT OF PAKISTAN</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="crumb">
            <button
              className="bare-button mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
            >
              {mobile ? <PanelLeftClose size={22} /> : <Menu size={22} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <div className="top-search-wrap menu-anchor">
              <div className="top-search">
                <Search size={16} />
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setMenu("search");
                  }}
                  onFocus={() => setMenu("search")}
                  onBlur={(e) => {
                    if (!e.currentTarget.closest(".top-search-wrap")?.contains(e.relatedTarget))
                      setMenu((old) => (old === "search" ? "" : old));
                  }}
                  placeholder="Search workspace…"
                  aria-label="Search workspace"
                />
                <kbd>
                  <Command size={11} /> K
                </kbd>
              </div>
              {menu === "search" && (
                <div className="dropdown top-search-menu">
                  {!ql && <p>Search by field name, crop, district, or farmer ID.</p>}
                  {farmResults.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        openField(f.id, "map");
                        setQ("");
                      }}
                    >
                      <MapPin size={16} />
                      <span>
                        {f.name}
                        <small>
                          {f.id} · {f.region}
                        </small>
                      </span>
                    </button>
                  ))}
                  {farmerResults.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        openFarmer(f.id, "profile");
                        setQ("");
                      }}
                    >
                      <Users size={16} />
                      <span>
                        {f.name}
                        <small>
                          {f.id} · {f.village}
                        </small>
                      </span>
                    </button>
                  ))}
                  {ql && !farmResults.length && !farmerResults.length && (
                    <p>No results for “{q}”.</p>
                  )}
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="district-button"
                onClick={() => toggleMenu("region")}
                aria-expanded={menu === "region"}
                title={`Switch region · ${locationName}`}
              >
                <MapPin size={16} />
                <span>{locationName}</span>
                <ChevronDown size={14} />
              </button>
              {menu === "region" && (
                <div className="dropdown district-menu">
                  <p>SWITCH REGION</p>
                  {regionOptions.map((r) => (
                    <button key={r} onClick={() => pickRegion(r)}>
                      <MapPin size={16} />
                      <span>{r || "All locations"}</span>
                      {r === region && <Check size={15} className="menu-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor notification-anchor">
              <button
                className="bare-button notification"
                onClick={() => toggleMenu("notifications")}
                aria-label="Weather and advisory shortcuts"
                aria-expanded={menu === "notifications"}
              >
                <Bell size={19} />
              </button>
              {menu === "notifications" && (
                <div className="dropdown notification-menu">
                  <p>WORKSPACE</p>
                  <button onClick={() => go("weather")}>
                    <Waves size={16} />
                    <span>
                      Weather &amp; Canal Data
                      <small>Search live weather providers</small>
                    </span>
                  </button>
                  <button onClick={() => go("advisory")}>
                    <Sparkles size={16} />
                    <span>
                      Advisory Center
                      <small>Review farmer replies</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <span className="top-divider" />
            <div className="menu-anchor profile-anchor">
              <button
                className="profile-button"
                onClick={() => toggleMenu("profile")}
                aria-label="Officer profile"
                aria-expanded={menu === "profile"}
              >
                <span className="avatar">AO</span>
                <span>
                  <strong>Agriculture Officer</strong>
                  <small>{officerSession ? "Officer session" : "Workspace access"}</small>
                </span>
                <ChevronDown size={13} />
              </button>
              {menu === "profile" && (
                <div className="dropdown profile-menu">
                  <p>{officerSession ? "OFFICER SESSION" : "WORKSPACE ACCESS"}</p>
                  {officerSession && (
                    <button
                      onClick={async () => {
                        try {
                          await request("/auth/sign-out", "POST");
                          setOfficerSession(false);
                          refreshRegistry();
                        } catch {
                          notify("Sign-out failed. Try again.");
                        }
                      }}
                    >
                      Sign out
                    </button>
                  )}
                  <button onClick={refreshRegistry}>
                    <RefreshCw size={16} />
                    <span>Refresh workspace data</span>
                  </button>
                  <button onClick={() => go("settings")}>
                    <Settings size={16} />
                    <span>
                      Workspace settings<small>Language, accessibility, and help</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          {registryStatus && (
            <div className="card surface registry-status" role="status">
              <span>{registryStatus}</span>
              {officerLogin ? (
                <form
                  className="officer-sign-in"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (officerBusy) return;
                    const form = event.currentTarget;
                    const password = String(new FormData(form).get("password") ?? "");
                    setOfficerError("");
                    setOfficerBusy(true);
                    try {
                      await request("/auth/sign-in", "POST", { password });
                      form.reset();
                      setOfficerSession(true);
                      refreshRegistry();
                    } catch (error) {
                      setOfficerError(error instanceof Error ? error.message : "Sign-in failed.");
                    } finally {
                      setOfficerBusy(false);
                    }
                  }}
                >
                  <label>
                    Officer password
                    <input
                      type="password"
                      name="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <button className="button primary" type="submit" disabled={officerBusy}>
                    Sign in
                  </button>
                  {officerError && <span role="alert">{officerError}</span>}
                </form>
              ) : (
                registryStatus !== "Loading registry…" && (
                  <button type="button" className="button" onClick={refreshRegistry}>
                    Retry
                  </button>
                )
              )}
            </div>
          )}
          {(!registryStatus ||
            page === "map" ||
            (page === "settings" && !officerLogin) ||
            (page === "weather" && registryStatus !== "Loading registry…")) && (
            <Suspense
              fallback={
                <div className="card surface" role="status">
                  Loading workspace…
                </div>
              }
            >
              {page === "map" && (
                <FarmMap
                  region={region}
                  fields={fields}
                  farmers={farmers}
                  field={mapField}
                  focusField={Boolean(fieldId && fieldId === mapField?.id)}
                  selectField={openField}
                  onProfile={() => mapField && openField(mapField.id, "profile")}
                  onWeather={() => mapField && openField(mapField.id, "weather")}
                  onIrrigation={() => mapField && openField(mapField.id, "irrigation")}
                  onRegister={() => setRegistration({})}
                  draft={draft}
                  setDraft={setDraft}
                  editing={editing}
                  setEditing={setEditing}
                  onSave={saveBoundary}
                  onDelete={deleteField}
                  notify={notify}
                  registryAvailable={!registryStatus}
                />
              )}
              {page === "overview" && (
                <LiveOverview
                  region={region}
                  fields={visibleFields}
                  farmers={farmers.filter((farmer) => !region || farmer.region === region)}
                  field={mapField}
                  open={openField}
                  go={go}
                />
              )}
              {page === "registry" && (
                <Registry
                  farmers={farmers}
                  fields={fields}
                  open={(id) => openFarmer(id, "profile")}
                  onRegister={() => setRegistration({})}
                />
              )}
              {page === "profile" && farmer && (
                <Profile
                  farmer={farmer}
                  fields={fields}
                  field={field}
                  open={openField}
                  go={go}
                  draw={() => {
                    go("map");
                    setDraftOwner(farmer.id);
                    setDraft([]);
                  }}
                />
              )}
              {page === "crops" && (
                <Crops
                  key={region}
                  fields={fields}
                  region={region}
                  open={openField}
                  openMap={() => go("map")}
                  onSeasonSaved={replaceField}
                />
              )}
              {page === "weather" && (
                <Weather
                  fields={fields}
                  field={mapField}
                  open={openField}
                  openMap={() => go("map")}
                />
              )}
              {page === "advisory" && (
                <LiveAdvisory fields={fields} selectedFieldId={fieldId} openMap={() => go("map")} />
              )}
              {page === "conversations" && (
                <WhatsAppConversations
                  farmers={farmers}
                  fields={fields}
                  selectedFarmerId={mapField?.farmerId ?? farmerId}
                  openAdvisory={(id) => openField(id, "advisory")}
                />
              )}
              {page === "irrigation" && (
                <FieldIntelligence
                  field={mapField}
                  fields={fields}
                  open={openField}
                  openMap={() => go("map")}
                />
              )}
              {page === "reports" && (
                <FieldHistory
                  field={mapField}
                  fields={visibleFields}
                  select={setFieldId}
                  openMap={() => go("map")}
                  onDelete={deleteField}
                />
              )}
              {page === "settings" && (
                <>
                  <PageTitle
                    eyebrow="WORKSPACE PREFERENCES"
                    title="Settings"
                    description="Review service availability and accessibility settings."
                  />
                  <WhatsAppSendingPhone />
                  <ServiceHealth />
                  <div className="grid-2">
                    <Card title="Accessibility & localization" action={<Globe2 size={19} />}>
                      <div className="settings-toggles">
                        <label>
                          <span>
                            <strong>Right-to-left layout preview</strong>
                            <small>
                              Test future Urdu layout. Interface copy remains in English.
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            checked={rtl}
                            onChange={(e) => setRtl(e.target.checked)}
                          />
                        </label>
                        <label>
                          <span>
                            <strong>Increase text size</strong>
                            <small>Increase the size of workspace content.</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={large}
                            onChange={(e) => setLarge(e.target.checked)}
                          />
                        </label>
                      </div>
                    </Card>
                  </div>
                  <Card title="Help & data policy">
                    <p className="body-copy">
                      Registry changes, crop seasons, and correspondence are saved to the database.
                      OpenWeather supplies current conditions and forecasts. Open-Meteo supplies
                      irrigation weather and modeled soil data.
                    </p>
                  </Card>
                </>
              )}
            </Suspense>
          )}
        </main>
      </div>
      {registration && (
        <RegisterModal
          model={registration}
          region={region}
          farmers={farmers}
          close={() => setRegistration(undefined)}
          save={saveRegistration}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="mini-icon">
            <Check size={16} />
          </span>
          {toast}
          <button className="bare-button" onClick={() => setToast("")} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
