export type Region = string;
export type Point = [number, number];
export type Page =
  | "overview"
  | "map"
  | "registry"
  | "profile"
  | "crops"
  | "irrigation"
  | "weather"
  | "advisory"
  | "conversations"
  | "reports"
  | "settings";
export type Farmer = {
  district?: string | null;
  tehsil?: string | null;
  id: string;
  name: string;
  email: string;
  phone: string;
  region: Region;
  village: string;
};
export type Field = {
  id: string;
  farmerId: string;
  name: string;
  region: Region;
  village: string;
  crop: string;
  previous: string;
  soil: string;
  source: string;
  acres: number;
  latitude?: number;
  longitude?: number;
  irrigation_status?: "canal_today" | "configured" | "setup_required" | "rain_fed";
  points: Point[];
  planted: string;
  stage: string;
  history: { date: string; label: string; detail: string }[];
};

export const acres = (value: number) =>
  value.toLocaleString("en-PK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type SelectField = (id: string, page?: Page) => void;
