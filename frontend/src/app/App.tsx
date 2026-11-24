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
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Sprout,
  Users,
  Waves,
  X,
} from "lucide-react";
import {
  initialFarmers,
  initialFields,
  measure,
  demoRegion,
  regions,
  validBoundary,
} from "@/domain/data";
import type { Farmer, Field, Page, Point, Region } from "@/domain/data";
import { Brand, Card, Chip, Demo, Details, PageTitle } from "@/components/ui";
import { FarmMap } from "@/features/map/FarmMap";
import type { AdvisoryLog } from "@/pages/Advisory";
import { RegisterModal, type Registration } from "@/features/registration/RegisterModal";
import {
  connected,
  loadRegistry,
  polygon,
  registerFarmer,
  updateBoundary,
} from "@/domain/registry";

const Crops = lazy(() => import("@/pages/Crops"));
const Irrigation = lazy(() => import("@/pages/Irrigation"));
const Overview = lazy(() => import("@/pages/Overview"));
const Profile = lazy(() => import("@/pages/Profile"));
const Registry = lazy(() => import("@/pages/Registry"));
const Reports = lazy(() => import("@/pages/Reports"));
const Weather = lazy(() => import("@/pages/Weather"));
const FieldIntelligence = lazy(() => import("@/pages/FieldIntelligence"));
const Advisory = lazy(() => import("@/pages/Advisory"));
const LiveAdvisory = lazy(() => import("@/pages/LiveAdvisory"));

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
  const [region, setRegion] = useState<Region>(connected ? "" : "Punjab");
  const [fields, setFields] = useState(connected ? [] : initialFields);
  const [farmers, setFarmers] = useState(connected ? [] : initialFarmers);
  const [fieldId, setFieldId] = useState(connected ? "" : initialFields[0].id);
  const [farmerId, setFarmerId] = useState(connected ? "" : initialFarmers[0].id);
  const [registryStatus, setRegistryStatus] = useState(connected ? "Loading registry…" : "");
  const [registryAttempt, setRegistryAttempt] = useState(0);
  const registryWrite = useRef(false);
  const [menu, setMenu] = useState("");
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<AdvisoryLog>({});
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftOwner, setDraftOwner] = useState<string>();
  const [registration, setRegistration] = useState<Registration>();
  const [toast, setToast] = useState("");
  const [rtl, setRtl] = useState(false);
  const [large, setLarge] = useState(false);
  const [readNotifications, setReadNotifications] = useState(false);
  const timeout = useRef<number>(undefined);
  const search = useRef<HTMLInputElement>(null);
  const field = fields.find((f) => f.id === fieldId);
  const farmer = farmers.find((f) => f.id === farmerId);
  const visibleFields = fields.filter((f) => !region || f.region === region);
  const mapField = visibleFields.find((f) => f.id === fieldId) ?? visibleFields[0];
  const district = demoRegion(region);
  const locationName = connected ? region || "All locations" : district.district;
  const regionOptions = connected
    ? ["", ...new Set(farmers.map((person) => person.region).sort())]
    : regions;
  const title =
    page === "profile"
      ? "Farmer Profile"
      : (navigation.flatMap((g) => [...g.items]).find((i) => i.id === page)?.label ?? "Farm Map");
  const count = Object.values(stage).filter((s) => s.stage === "sent").length;
  const pendingCount = farmers.filter(
    (f) => f.region === region && stage[f.id]?.stage !== "sent",
  ).length;

  useEffect(() => {
    if (!connected) return;
    let active = true;
    loadRegistry()
      .then((data) => {
        if (!active) return;
        setFarmers(data.farmers);
        setFields(data.fields);
        setRegistryStatus("");
      })
      .catch(() => {
        if (active) setRegistryStatus("The registry could not connect to the API.");
      });
    return () => {
      active = false;
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
  const go = (next: Page) => {
    if (page !== next) {
      setMenu("");
      setDraft(null);
      setEditing(false);
      setDraftOwner(undefined);
      setPage(next);
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
    if (!connected || (region && found.region !== region)) setRegion(found.region);
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
    if (!connected || (region && found.region !== region)) setRegion(found.region);
    setFieldId(
      fields.find((f) => f.farmerId === id)?.id ??
        (connected ? "" : fields.find((f) => f.region === found.region)?.id) ??
        "",
    );
    setMenu("");
  };
  const replaceField = (saved: Field) =>
    setFields((existing) =>
      existing.some((field) => field.id === saved.id)
        ? existing.map((field) => (field.id === saved.id ? saved : field))
        : [...existing, saved],
    );
  const saveBoundary = async () => {
    if (!draft || (connected ? draft.length < 3 : !validBoundary(draft))) return;
    if (editing && mapField) {
      if (connected) {
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
        return;
      }
      setFields(
        fields.map((f) =>
          f.id === mapField.id ? { ...f, points: draft, acres: measure(draft) } : f,
        ),
      );
      setDraft(null);
      setEditing(false);
      notify("Boundary saved in this demo session.");
    } else setRegistration({ points: draft, owner: draftOwner });
  };
  const saveRegistration = async (
    owner: Farmer,
    detail?: Pick<Field, "name" | "crop" | "soil" | "source">,
  ) => {
    if (connected) {
      const points = registration?.points;
      const saved = await registerFarmer(
        owner,
        points && detail ? { ...detail, boundary: polygon(points) } : undefined,
      );
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
      return;
    }
    const person = owner.id
      ? owner
      : {
          ...owner,
          id: `FMR-${String(301 + farmers.length - initialFarmers.length).padStart(4, "0")}`,
        };
    if (!owner.id) setFarmers([...farmers, person]);
    const points = registration?.points;
    go("profile");
    setFarmerId(person.id);
    setRegion(person.region);
    if (points && detail) {
      const newField: Field = {
        ...detail,
        id: `AP-${region === "Punjab" ? "PB" : "KP"}-${String(501 + fields.length - initialFields.length).padStart(4, "0")}`,
        farmerId: person.id,
        region,
        village: person.village,
        points,
        acres: measure(points),
        planted: "Not recorded",
        previous: "Not recorded",
        stage: "Not recorded",
        rate: region === "Punjab" ? 1850 : 1600,
        history: [
          {
            date: "20 Mar 2026",
            label: "Field registered",
            detail: "Boundary and crop linked in the demonstration",
          },
        ],
      };
      setFields([...fields, newField]);
      setFieldId(newField.id);
      notify("Farm saved and linked to the farmer profile.");
    } else {
      setFieldId(fields.find((f) => f.region === person.region)?.id ?? "");
      notify("Farmer added to the demo registry.");
    }
    setRegistration(undefined);
    setDraft(null);
    setEditing(false);
    setDraftOwner(undefined);
  };
  const ql = q.trim().toLowerCase();
  const farmResults = ql
    ? fields
        .filter((f) =>
          `${f.id} ${f.name} ${f.crop} ${connected ? f.region : demoRegion(f.region).district}`
            .toLowerCase()
            .includes(ql),
        )
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
                          {f.id} · {connected ? f.region : demoRegion(f.region).district}
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
                title="Switch region"
              >
                <MapPin size={16} />
                <span>
                  {connected
                    ? locationName
                    : `${district.district}, ${region === "Punjab" ? "Punjab" : "KP"}`}
                </span>
                <ChevronDown size={14} />
              </button>
              {menu === "region" && (
                <div className="dropdown district-menu">
                  <p>SWITCH REGION</p>
                  {regionOptions.map((r) => (
                    <button key={r} onClick={() => pickRegion(r)}>
                      <MapPin size={16} />
                      <span>
                        {connected ? r || "All locations" : demoRegion(r).district}
                        {!connected && <small>{r}</small>}
                      </span>
                      {r === region && <Check size={15} className="menu-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor notification-anchor">
              <button
                className="bare-button notification"
                onClick={() => {
                  toggleMenu("notifications");
                  setReadNotifications(true);
                }}
                aria-label="Notifications"
                aria-expanded={menu === "notifications"}
              >
                <Bell size={19} />
                {!readNotifications && <i />}
              </button>
              {menu === "notifications" && (
                <div className="dropdown notification-menu">
                  <p>NOTIFICATIONS · DEMO</p>
                  <button onClick={() => go("weather")}>
                    <Waves size={16} />
                    <span>
                      {district.rain} mm rainfall modeled
                      <small>{district.district} · Weather & Canal Data</small>
                    </span>
                  </button>
                  <button onClick={() => go("advisory")}>
                    <Sparkles size={16} />
                    <span>
                      Farmer reports to review
                      <small>
                        {pendingCount} conversations in {district.district}
                      </small>
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
                <span className="avatar">AK</span>
                <span>
                  <strong>Ayesha Khan</strong>
                  <small>Agriculture Officer</small>
                </span>
                <ChevronDown size={13} />
              </button>
              {menu === "profile" && (
                <div className="dropdown profile-menu">
                  <p>DEMO OFFICER</p>
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
            <div className="card surface" role="status">
              {registryStatus}
              {registryStatus !== "Loading registry…" && (
                <button
                  onClick={() => {
                    setRegistryStatus("Loading registry…");
                    setRegistryAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {!registryStatus && (
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
                  setRegion={pickRegion}
                  fields={fields}
                  farmers={farmers}
                  field={mapField}
                  selectField={openField}
                  onProfile={() => mapField && openField(mapField.id, "profile")}
                  onRegister={() => setRegistration({})}
                  draft={draft}
                  setDraft={setDraft}
                  editing={editing}
                  setEditing={setEditing}
                  onSave={saveBoundary}
                  notify={notify}
                />
              )}
              {page === "overview" && connected && (
                <Card title="Registry overview">
                  <Details
                    rows={[
                      [
                        "Registered farmers",
                        farmers.filter((farmer) => !region || farmer.region === region).length,
                      ],
                      ["Mapped fields", visibleFields.length],
                    ]}
                  />
                </Card>
              )}
              {page === "overview" && !connected && (
                <Overview
                  region={region}
                  fields={fields}
                  farmers={farmers}
                  open={openField}
                  go={go}
                  pending={pendingCount}
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
                  advisoryCount={stage[farmer.id]?.stage === "sent" ? 1 : 0}
                />
              )}
              {page === "crops" && (
                <Crops
                  key={region}
                  fields={fields}
                  region={region}
                  open={openField}
                  onSeasonSaved={replaceField}
                />
              )}
              {page === "irrigation" && !connected && mapField && (
                <Irrigation key={mapField.id} field={mapField} fields={fields} open={openField} />
              )}
              {page === "weather" && !connected && mapField && (
                <Weather region={region} fields={fields} field={mapField} open={openField} />
              )}
              {page === "advisory" && connected && (
                <LiveAdvisory
                  fields={fields}
                  selectedFieldId={fieldId}
                  onFieldUpdated={replaceField}
                />
              )}
              {page === "advisory" && !connected && (
                <Advisory
                  farmers={farmers}
                  fields={fields}
                  farmer={farmer}
                  pick={openFarmer}
                  log={stage}
                  setLog={(id, value) => setStage((old) => ({ ...old, [id]: value }))}
                  notify={notify}
                  onApprove={(person, plot, reply) => {
                    setFields((old) =>
                      old.map((f) =>
                        f.id === plot.id
                          ? {
                              ...f,
                              history: [
                                ...f.history,
                                {
                                  date: "19 Mar 2026",
                                  label: "Irrigation reported by email",
                                  detail: `${person.id === "FMR-0108" || plot.source.includes("Tubewell") ? "Tubewell · 2 hours" : "Method and duration not provided"} · officer reviewed in demo`,
                                },
                              ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
                            }
                          : f,
                      ),
                    );
                    setStage((old) => ({
                      ...old,
                      [person.id]: { stage: "sent", fieldId: plot.id, reply },
                    }));
                  }}
                />
              )}
              {connected && (page === "irrigation" || page === "weather") && (
                <FieldIntelligence mode={page} field={mapField} fields={fields} open={openField} />
              )}
              {connected && page === "reports" && (
                <Card title={title}>
                  <p>Live data for this page is pending integration.</p>
                </Card>
              )}
              {page === "reports" && !connected && (
                <Reports fields={fields} farmers={farmers} open={openField} advisoryCount={count} />
              )}
              {page === "settings" && (
                <>
                  <PageTitle
                    eyebrow="WORKSPACE PREFERENCES"
                    title="Settings"
                    description="Configure your demonstration workspace and review its data policy."
                  >
                    <Demo />
                  </PageTitle>
                  <div className="grid-2">
                    <Card title="Officer profile" action={<Chip dot>Demo account</Chip>}>
                      <Details
                        rows={[
                          ["Name", "Ayesha Khan"],
                          ["Role", "Agriculture Officer"],
                          ["Department", "Agriculture Department"],
                          [connected ? "Current location" : "Current district", locationName],
                        ]}
                      />
                    </Card>
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
                      {connected ? (
                        "Registry changes, crop seasons, and correspondence are saved to the connected database."
                      ) : (
                        <>
                          AquaProof uses synthetic records, demonstration imagery, and simulated
                          advisory delivery. Changes are held only for this browser tab session and
                          reset on reload. Use the Farm Map to register fields, Irrigation
                          Intelligence to compare scenarios, and AI Advisory Center for
                          officer-reviewed replies.
                        </>
                      )}
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
