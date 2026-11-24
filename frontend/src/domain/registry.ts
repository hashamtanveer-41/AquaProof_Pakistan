import type { Farmer, Field, Point } from "./data";

const api = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const connected = true;
let officerToken = "";

export function setOfficerToken(token: string) {
  officerToken = token.trim();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Boundary = { type: "Polygon"; coordinates: Point[][] };
type Season = { id: number; crop: string; variety: string | null; planted: string | null };
type SavedField = Omit<Field, "points" | "crop" | "previous" | "planted" | "rate"> & {
  boundary: Boundary;
  seasons: Season[];
};

export type FieldDetails = Pick<Field, "name" | "crop" | "soil" | "source">;

export function polygon(points: Point[]): Boundary {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

export function toField({ boundary, seasons, history, ...base }: SavedField): Field {
  return {
    ...base,
    points: boundary.coordinates[0].slice(0, -1),
    crop: seasons[0]?.crop ?? "Not recorded",
    previous: seasons[1]?.crop ?? "Not recorded",
    planted: seasons[0]?.planted ?? "Not recorded",
    rate: 0,
    history: [
      ...history,
      ...seasons.flatMap(({ crop, planted }) =>
        planted ? [{ date: planted, label: "Crop season started", detail: crop }] : [],
      ),
    ].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = method === "GET" ? AbortSignal.timeout(35_000) : undefined;
  const response = await fetch(`${api}/api${path}`, {
    method,
    cache: "no-store",
    signal: signal && timeout ? AbortSignal.any([signal, timeout]) : (signal ?? timeout),
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(officerToken && { Authorization: `Bearer ${officerToken}` }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const detail = result?.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? String(detail[0]?.msg ?? "Check the submitted details.")
          : `Request failed (${response.status}).`,
    );
  }
  return response.json();
}

export async function loadRegistry(signal?: AbortSignal) {
  const data = await request<{ farmers: Farmer[]; fields: SavedField[] }>(
    "/registry",
    "GET",
    undefined,
    signal,
  );
  return { farmers: data.farmers, fields: data.fields.map(toField) };
}

export async function fetchField(id: string) {
  return toField(await request<SavedField>(`/fields/${encodeURIComponent(id)}`));
}

export async function registerFarmer(owner: Farmer, field?: FieldDetails & { boundary: Boundary }) {
  const { id, ...farmer } = owner;
  const result = await request<{ farmer: Farmer; field: SavedField | null }>(
    "/registrations",
    "POST",
    {
      ...(id ? { farmer_id: id } : { farmer }),
      field,
    },
  );
  return { farmer: result.farmer, field: result.field ? toField(result.field) : undefined };
}

export async function updateBoundary(id: string, points: Point[]) {
  return toField(await request<SavedField>(`/fields/${id}`, "PATCH", polygon(points)));
}

export function archiveField(id: string) {
  return request<{ id: string }>(`/fields/${encodeURIComponent(id)}`, "DELETE");
}

export async function startSeason(id: string, crop: string, variety: string, planted: string) {
  return toField(
    await request<SavedField>(`/crop-seasons?field_id=${encodeURIComponent(id)}`, "POST", {
      crop,
      variety: variety || null,
      planted,
    }),
  );
}
