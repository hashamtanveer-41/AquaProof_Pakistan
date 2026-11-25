"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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
import { regionData, regions } from "@/domain/data";
import { PAGE_ROUTES } from "@/domain/routes";
import { Brand, Button } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { RegisterModal } from "@/features/registration/RegisterModal";

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

export function AppShell({ children }: { children: ReactNode }) {
  const {
    page,
    region,
    fields,
    farmers,
    district,
    registryStatus,
    retryRegistry,
    registration,
    setRegistration,
    saveRegistration,
    toast,
    dismissToast,
    rtl,
    large,
    readNotifications,
    setReadNotifications,
    pendingCount,
    go,
    openField,
    openFarmer,
    pickRegion,
  } = useWorkspace();

  const [menu, setMenu] = useState("");
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const title =
    page === "profile"
      ? "Farmer Profile"
      : (navigation.flatMap((g) => [...g.items]).find((i) => i.id === page)?.label ?? "Farm Map");

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
    };
  }, []);

  const ql = q.trim().toLowerCase();
  const farmResults = ql
    ? fields
        .filter((f) =>
          `${f.id} ${f.name} ${f.crop} ${regionData[f.region].district}`.toLowerCase().includes(ql),
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
          type="button"
          className="sidebar-overlay"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <button
          type="button"
          className="brand-button"
          aria-label="AquaProof Pakistan Farm Map"
          onClick={() => {
            setMenu("");
            setMobile(false);
            go("map");
          }}
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
                  <Link
                    href={PAGE_ROUTES[item.id]}
                    className={`nav-item ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    key={item.id}
                    onClick={() => {
                      setMenu("");
                      setMobile(false);
                    }}
                  >
                    <item.icon size={18} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {active && <i />}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <Link
            href={PAGE_ROUTES.settings}
            className="nav-item support"
            onClick={() => {
              setMenu("");
              setMobile(false);
            }}
          >
            <CircleHelp size={18} />
            <span>Help &amp; Support</span>
          </Link>
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
              type="button"
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
                      type="button"
                      key={f.id}
                      onClick={() => {
                        openField(f.id, "map");
                        setMenu("");
                        setQ("");
                      }}
                    >
                      <MapPin size={16} />
                      <span>
                        {f.name}
                        <small>
                          {f.id} · {regionData[f.region].district}
                        </small>
                      </span>
                    </button>
                  ))}
                  {farmerResults.map((f) => (
                    <button
                      type="button"
                      key={f.id}
                      onClick={() => {
                        openFarmer(f.id, "profile");
                        setMenu("");
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
                type="button"
                className="district-button"
                onClick={() => toggleMenu("region")}
                aria-expanded={menu === "region"}
                title="Switch region"
              >
                <MapPin size={16} />
                <span>
                  {district.district}, {region === "Punjab" ? "Punjab" : "KP"}
                </span>
                <ChevronDown size={14} />
              </button>
              {menu === "region" && (
                <div className="dropdown district-menu">
                  <p>SWITCH REGION</p>
                  {regions.map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => {
                        pickRegion(r);
                        setMenu("");
                      }}
                    >
                      <MapPin size={16} />
                      <span>
                        {regionData[r].district}
                        <small>{r}</small>
                      </span>
                      {r === region && <Check size={15} className="menu-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor notification-anchor">
              <button
                type="button"
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
                  <button
                    type="button"
                    onClick={() => {
                      setMenu("");
                      go("weather");
                    }}
                  >
                    <Waves size={16} />
                    <span>
                      {district.rain} mm rainfall modeled
                      <small>{district.district} · Weather &amp; Canal Data</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu("");
                      go("advisory");
                    }}
                  >
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
                type="button"
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
                  <button
                    type="button"
                    onClick={() => {
                      setMenu("");
                      go("settings");
                    }}
                  >
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
          {registryStatus ? (
            <div className="card surface" role="status">
              <div className="flex items-center justify-between gap-3">
                <span>{registryStatus}</span>
                {registryStatus !== "Loading registry…" && (
                  <Button onClick={retryRegistry}>Retry</Button>
                )}
              </div>
            </div>
          ) : (
            children
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
          <button
            type="button"
            className="bare-button"
            onClick={dismissToast}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
