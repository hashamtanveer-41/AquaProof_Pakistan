"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { initialFarmers, initialFields, measure, regionData, validBoundary } from "@/domain/data";
import type { Farmer, Field, Page, Point, Region } from "@/domain/data";
import {
  connected,
  loadRegistry,
  polygon,
  registerFarmer,
  updateBoundary,
} from "@/domain/registry";
import { PAGE_ROUTES, pageFromPathname } from "@/domain/routes";
import type { AdvisoryLog } from "@/views/Advisory";
import type { Registration } from "@/features/registration/RegisterModal";

type WorkspaceContextValue = {
  page: Page;
  region: Region;
  fields: Field[];
  farmers: Farmer[];
  fieldId: string;
  farmerId: string;
  field?: Field;
  farmer?: Farmer;
  mapField?: Field;
  district: (typeof regionData)[Region];
  registryStatus: string;
  retryRegistry: () => void;
  stage: AdvisoryLog;
  setStageValue: (id: string, value: AdvisoryLog[string]) => void;
  approveDemoAdvisory: (person: Farmer, plot: Field, reply: string) => void;
  draft: Point[] | null;
  setDraft: (v: Point[] | null) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  draftOwner?: string;
  setDraftOwner: (v: string | undefined) => void;
  registration?: Registration;
  setRegistration: (v: Registration | undefined) => void;
  toast: string;
  notify: (message: string) => void;
  dismissToast: () => void;
  rtl: boolean;
  setRtl: (v: boolean) => void;
  large: boolean;
  setLarge: (v: boolean) => void;
  readNotifications: boolean;
  setReadNotifications: (v: boolean) => void;
  count: number;
  pendingCount: number;
  go: (next: Page) => void;
  openField: (id: string, next?: Page) => void;
  openFarmer: (id: string, next?: Page) => void;
  pickRegion: (r: Region) => void;
  replaceField: (saved: Field) => void;
  saveBoundary: () => Promise<void>;
  saveRegistration: (
    owner: Farmer,
    detail?: Pick<Field, "name" | "crop" | "soil" | "source">,
  ) => Promise<void>;
  selectFarmerById: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/map";
  const page = pageFromPathname(pathname);

  const [region, setRegion] = useState<Region>("Punjab");
  const [fields, setFields] = useState<Field[]>(connected ? [] : initialFields);
  const [farmers, setFarmers] = useState<Farmer[]>(connected ? [] : initialFarmers);
  const [fieldId, setFieldId] = useState(connected ? "" : initialFields[0].id);
  const [farmerId, setFarmerId] = useState(connected ? "" : initialFarmers[0].id);
  const [registryStatus, setRegistryStatus] = useState(connected ? "Loading registry…" : "");
  const [registryAttempt, setRegistryAttempt] = useState(0);
  const registryWrite = useRef(false);

  const [stage, setStage] = useState<AdvisoryLog>({});
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftOwner, setDraftOwner] = useState<string>();
  const [registration, setRegistration] = useState<Registration>();
  const [toast, setToast] = useState("");
  const [rtl, setRtl] = useState(false);
  const [large, setLarge] = useState(false);
  const [readNotifications, setReadNotifications] = useState(false);
  const timeout = useRef<number | undefined>(undefined);

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
    return () => {
      window.clearTimeout(timeout.current);
    };
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const dismissToast = useCallback(() => setToast(""), []);

  const retryRegistry = useCallback(() => {
    setRegistryStatus("Loading registry…");
    setRegistryAttempt((attempt) => attempt + 1);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      window.scrollTo({ top: 0, behavior: "instant" });
    },
    [router],
  );

  const go = useCallback(
    (next: Page) => {
      if (page !== next) {
        setDraft(null);
        setEditing(false);
        setDraftOwner(undefined);
        if (next === "profile") {
          const targetFarmer = farmerId || farmers[0]?.id;
          navigate(targetFarmer ? `/farmers/${encodeURIComponent(targetFarmer)}` : "/registry");
        } else {
          navigate(PAGE_ROUTES[next]);
        }
      }
    },
    [page, farmerId, farmers, navigate],
  );

  const openField = useCallback(
    (id: string, next?: Page) => {
      const found = fields.find((f) => f.id === id);
      if (!found) return;
      if (found.region !== region || fieldId !== id) {
        setDraft(null);
        setDraftOwner(undefined);
        setEditing(false);
      }
      setFieldId(id);
      setFarmerId(found.farmerId);
      setRegion(found.region);
      if (next) {
        if (next === "profile") {
          navigate(`/farmers/${encodeURIComponent(found.farmerId)}`);
        } else if (page !== next) {
          navigate(PAGE_ROUTES[next]);
        }
      }
    },
    [fields, region, fieldId, page, navigate],
  );

  const openFarmer = useCallback(
    (id: string, next?: Page) => {
      const found = farmers.find((f) => f.id === id);
      if (!found) return;
      setFarmerId(id);
      setRegion(found.region);
      setFieldId(
        fields.find((f) => f.farmerId === id)?.id ??
          (connected ? "" : fields.find((f) => f.region === found.region)?.id) ??
          "",
      );
      if (next === "profile") {
        setDraft(null);
        setEditing(false);
        setDraftOwner(undefined);
        navigate(`/farmers/${encodeURIComponent(id)}`);
      } else if (next && page !== next) {
        setDraft(null);
        setEditing(false);
        setDraftOwner(undefined);
        navigate(PAGE_ROUTES[next]);
      }
    },
    [farmers, fields, page, navigate],
  );

  const selectFarmerById = useCallback(
    (id: string) => {
      const found = farmers.find((f) => f.id === id);
      if (!found) return;
      setFarmerId(id);
      setRegion(found.region);
      setFieldId((current) => {
        const currentOwned = fields.find((f) => f.id === current && f.farmerId === id);
        if (currentOwned) return currentOwned.id;
        return (
          fields.find((f) => f.farmerId === id)?.id ??
          (connected ? "" : fields.find((f) => f.region === found.region)?.id) ??
          ""
        );
      });
    },
    [farmers, fields],
  );

  const pickRegion = useCallback(
    (r: Region) => {
      if (r !== region) {
        setRegion(r);
        setDraft(null);
        setEditing(false);
        setDraftOwner(undefined);
        const f = fields.find((item) => item.region === r);
        if (f) {
          setFieldId(f.id);
          setFarmerId(f.farmerId);
        }
      }
    },
    [region, fields],
  );

  const replaceField = useCallback((saved: Field) => {
    setFields((existing) =>
      existing.some((item) => item.id === saved.id)
        ? existing.map((item) => (item.id === saved.id ? saved : item))
        : [...existing, saved],
    );
  }, []);

  const mapField =
    fields.find((f) => f.id === fieldId && f.region === region) ??
    fields.find((f) => f.region === region);

  const saveBoundary = useCallback(async () => {
    if (!draft || (connected ? draft.length < 3 : !validBoundary(draft))) return;
    if (editing && mapField) {
      if (connected) {
        if (registryWrite.current) return;
        registryWrite.current = true;
        try {
          replaceField(await updateBoundary(mapField.id, draft));
          setDraft((current) => (current === draft ? null : current));
          setEditing(false);
          notify("Boundary saved.");
        } catch (error) {
          notify(error instanceof Error ? error.message : "The boundary could not be saved.");
        } finally {
          registryWrite.current = false;
        }
        return;
      }
      setFields((existing) =>
        existing.map((f) =>
          f.id === mapField.id ? { ...f, points: draft, acres: measure(draft) } : f,
        ),
      );
      setDraft(null);
      setEditing(false);
      notify("Boundary saved in this demo session.");
    } else {
      setRegistration({ points: draft, owner: draftOwner });
    }
  }, [draft, editing, mapField, draftOwner, replaceField, notify]);

  const saveRegistration = useCallback(
    async (owner: Farmer, detail?: Pick<Field, "name" | "crop" | "soil" | "source">) => {
      if (connected) {
        const points = registration?.points;
        const saved = await registerFarmer(
          owner,
          points && detail ? { ...detail, boundary: polygon(points) } : undefined,
        );
        setFarmers((existing) =>
          existing.some((item) => item.id === saved.farmer.id)
            ? existing
            : [...existing, saved.farmer],
        );
        if (saved.field) replaceField(saved.field);
        setDraft(null);
        setEditing(false);
        setDraftOwner(undefined);
        setFarmerId(saved.farmer.id);
        setRegion(saved.farmer.region);
        setFieldId(saved.field?.id ?? "");
        setRegistration(undefined);
        navigate(`/farmers/${encodeURIComponent(saved.farmer.id)}`);
        notify(saved.field ? "Farm saved and linked to the farmer profile." : "Farmer registered.");
        return;
      }
      const person = owner.id
        ? owner
        : {
            ...owner,
            id: `FMR-${String(301 + farmers.length - initialFarmers.length).padStart(4, "0")}`,
          };
      if (!owner.id) setFarmers((existing) => [...existing, person]);
      const points = registration?.points;
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
        setFields((existing) => [...existing, newField]);
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
      navigate(`/farmers/${encodeURIComponent(person.id)}`);
    },
    [registration, farmers.length, fields, region, replaceField, navigate, notify],
  );

  const setStageValue = useCallback((id: string, value: AdvisoryLog[string]) => {
    setStage((old) => ({ ...old, [id]: value }));
  }, []);

  const approveDemoAdvisory = useCallback((person: Farmer, plot: Field, reply: string) => {
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
  }, []);

  const field = fields.find((f) => f.id === fieldId);
  const farmer = farmers.find((f) => f.id === farmerId);
  const district = regionData[region];
  const count = Object.values(stage).filter((s) => s.stage === "sent").length;
  const pendingCount = farmers.filter(
    (f) => f.region === region && stage[f.id]?.stage !== "sent",
  ).length;

  return (
    <WorkspaceContext.Provider
      value={{
        page,
        region,
        fields,
        farmers,
        fieldId,
        farmerId,
        field,
        farmer,
        mapField,
        district,
        registryStatus,
        retryRegistry,
        stage,
        setStageValue,
        approveDemoAdvisory,
        draft,
        setDraft,
        editing,
        setEditing,
        draftOwner,
        setDraftOwner,
        registration,
        setRegistration,
        toast,
        notify,
        dismissToast,
        rtl,
        setRtl,
        large,
        setLarge,
        readNotifications,
        setReadNotifications,
        count,
        pendingCount,
        go,
        openField,
        openFarmer,
        pickRegion,
        replaceField,
        saveBoundary,
        saveRegistration,
        selectFarmerById,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
