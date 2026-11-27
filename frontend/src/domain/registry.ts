import type { Farmer, Field, Point } from "./data";

const api = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function mapServerRequest(path: string) {
  return { url: `${api}${path}`, credentials: "same-origin" as const };
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
type SavedField = Omit<Field, "points" | "crop" | "previous" | "planted"> & {
  boundary: Boundary;
  seasons: Season[];
};

export type FieldDetails = Pick<Field, "name" | "crop" | "soil" | "source">;

export function polygon(points: Point[]): Boundary {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

function toField({ boundary, seasons, history, ...base }: SavedField): Field {
  return {
    ...base,
    points: boundary.coordinates[0].slice(0, -1),
    crop: seasons[0]?.crop ?? "Not recorded",
    previous: seasons[1]?.crop ?? "Not recorded",
    planted: seasons[0]?.planted ?? "Not recorded",
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
    credentials: "same-origin",
    signal: signal && timeout ? AbortSignal.any([signal, timeout]) : (signal ?? timeout),
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
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
  return response.status === 204 ? (undefined as T) : response.json();
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

export async function requestImage(path: string, signal: AbortSignal) {
  const response = await fetch(`${api}/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, "The pairing QR is not available yet.");
  return response.blob();
}

export async function registerFarmer(owner: Farmer, field?: FieldDetails & { boundary: Boundary }) {
  const { id, email, ...farmer } = owner;
  const result = await request<{ farmer: Farmer; field: SavedField | null }>(
    "/registrations",
    "POST",
    {
      ...(id ? { farmer_id: id } : { farmer: { ...farmer, email: email || undefined } }),
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

export function permanentlyDeleteField(id: string) {
  return request<void>("/registry/permanent-field-deletion", "POST", {
    field_id: id,
    confirmation: "DELETE",
  });
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
