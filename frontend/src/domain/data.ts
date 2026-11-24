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
  | "reports"
  | "settings";
export type Farmer = {
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
  rate: number;
  history: { date: string; label: string; detail: string }[];
};

export const regions = ["Punjab", "Khyber Pakhtunkhwa"] as const;
const regionData = {
  Punjab: {
    district: "Faisalabad",
    short: "Punjab",
    village: "Chak 208 RB",
    center: "31.4180° N, 73.0790° E",
    canal: "Rakh Branch Canal",
    road: "Jaranwala Road",
    image: `${import.meta.env.BASE_URL}punjab-satellite.webp`,
    temperature: 26,
    humidity: 57,
    rain: 4,
    wind: 13,
    eto: 4.2,
    depletion: 43,
    canalDay: "24 Mar",
    flow: "1,120 cusecs",
    forecasts: [25, 26, 27, 26, 24, 25, 27],
    moisture: [42, 44, 48, 54, 46, 40, 43],
  },
  "Khyber Pakhtunkhwa": {
    district: "Mardan",
    short: "Khyber Pakhtunkhwa",
    village: "Takht Bhai",
    center: "34.1986° N, 72.0404° E",
    canal: "Upper Swat Canal",
    road: "Mardan Ring Road",
    image: `${import.meta.env.BASE_URL}mardan-satellite.webp`,
    temperature: 22,
    humidity: 69,
    rain: 12,
    wind: 9,
    eto: 3.3,
    depletion: 32,
    canalDay: "25 Mar",
    flow: "760 cusecs",
    forecasts: [22, 23, 21, 20, 22, 24, 23],
    moisture: [32, 35, 32, 26, 28, 31, 32],
  },
};

export function demoRegion(region: Region) {
  return region === "Khyber Pakhtunkhwa" ? regionData[region] : regionData.Punjab;
}

export const initialFarmers: Farmer[] = [
  {
    id: "FMR-0108",
    name: "Muhammad Aslam",
    email: "aslam@example.com",
    phone: "+92 300 000 0108",
    region: "Punjab",
    village: "Chak 208 RB",
  },
  {
    id: "FMR-0112",
    name: "Rashid Ahmed",
    email: "rashid@example.com",
    phone: "+92 300 000 0112",
    region: "Punjab",
    village: "Chak 209 RB",
  },
  {
    id: "FMR-0117",
    name: "Shazia Bibi",
    email: "shazia@example.com",
    phone: "+92 300 000 0117",
    region: "Punjab",
    village: "Chak 208 RB",
  },
  {
    id: "FMR-0121",
    name: "Ali Hassan",
    email: "ali@example.com",
    phone: "+92 300 000 0121",
    region: "Punjab",
    village: "Chak 210 RB",
  },
  {
    id: "FMR-0124",
    name: "Abdul Rehman",
    email: "rehman@example.com",
    phone: "+92 300 000 0124",
    region: "Punjab",
    village: "Chak 209 RB",
  },
  {
    id: "FMR-0201",
    name: "Gul Rahman",
    email: "gul@example.com",
    phone: "+92 300 000 0201",
    region: "Khyber Pakhtunkhwa",
    village: "Takht Bhai",
  },
  {
    id: "FMR-0207",
    name: "Samina Khan",
    email: "samina@example.com",
    phone: "+92 300 000 0207",
    region: "Khyber Pakhtunkhwa",
    village: "Shergarh",
  },
];

const P: Region = "Punjab";
const K: Region = "Khyber Pakhtunkhwa";
function seed(
  id: string,
  farmer: number,
  name: string,
  region: Region,
  points: Point[],
  crop: string,
  source: string,
  soil: string,
): Field {
  const owner = initialFarmers[farmer];
  const stage =
    crop === "Wheat"
      ? "Stem elongation"
      : crop === "Maize"
        ? "Early vegetative (V3)"
        : "Vegetative growth";
  const planted =
    crop === "Wheat" ? "18 Dec 2025" : crop === "Maize" ? "04 Mar 2026" : "25 Feb 2026";
  return {
    id,
    farmerId: owner.id,
    name,
    region,
    village: owner.village,
    crop,
    previous: crop === "Wheat" ? "Rice" : "Wheat",
    soil,
    source,
    acres: measure(points),
    points,
    planted,
    stage,
    rate: region === P ? 1850 : 1600,
    history: [
      { date: planted, label: "Planting recorded", detail: `${crop} season established` },
      {
        date: region === P ? "12 Mar 2026" : "15 Mar 2026",
        label: "Irrigation recorded",
        detail: `${source.split(" + ")[0]} · farmer reported`,
      },
      {
        date: "20 Mar 2026",
        label: "Crop stage review",
        detail: `${stage} · demonstration estimate`,
      },
      {
        date: "26 Mar 2026",
        label: "Fertilizer plan review",
        detail: "Officer confirmation required",
      },
    ],
  };
}

export function measure(points: Point[]) {
  const area =
    Math.abs(
      points.reduce((sum, [x, y], i) => {
        const [nx, ny] = points[(i + 1) % points.length];
        return sum + x * ny - y * nx;
      }, 0),
    ) / 2;
  return (area * 9.61) / 4046.8564;
}

export function validBoundary(points: Point[]) {
  if (
    points.length < 3 ||
    measure(points) < 0.01 ||
    new Set(points.map((p) => p.join(","))).size !== points.length
  )
    return false;
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const between = (a: Point, b: Point, c: Point) =>
    c.every((v, i) => v >= Math.min(a[i], b[i]) && v <= Math.max(a[i], b[i]));
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = points[j],
        d = points[(j + 1) % n];
      const abc = cross(a, b, c),
        abd = cross(a, b, d),
        cda = cross(c, d, a),
        cdb = cross(c, d, b);
      if (
        (abc * abd < 0 && cda * cdb < 0) ||
        (abc === 0 && between(a, b, c)) ||
        (abd === 0 && between(a, b, d)) ||
        (cda === 0 && between(c, d, a)) ||
        (cdb === 0 && between(c, d, b))
      )
        return false;
    }
  }
  return true;
}

export const initialFields: Field[] = [
  seed(
    "AP-PB-0241",
    0,
    "Aslam Wheat Field",
    P,
    [
      [463, 235],
      [546, 218],
      [568, 319],
      [481, 333],
    ],
    "Wheat",
    "Canal + Tubewell",
    "Loam",
  ),
  seed(
    "AP-PB-0242",
    1,
    "Rashid North Field",
    P,
    [
      [205, 98],
      [319, 77],
      [335, 148],
      [221, 165],
    ],
    "Wheat",
    "Canal",
    "Silt loam",
  ),
  seed(
    "AP-PB-0243",
    2,
    "Shazia Maize Field",
    P,
    [
      [660, 88],
      [741, 73],
      [763, 157],
      [680, 175],
    ],
    "Maize",
    "Tubewell",
    "Sandy loam",
  ),
  seed(
    "AP-PB-0244",
    3,
    "Hassan East Field",
    P,
    [
      [745, 299],
      [841, 280],
      [862, 353],
      [764, 376],
    ],
    "Sugarcane",
    "Canal",
    "Clay loam",
  ),
  seed(
    "AP-PB-0245",
    4,
    "Rehman South Field",
    P,
    [
      [248, 382],
      [361, 356],
      [382, 422],
      [270, 449],
    ],
    "Wheat",
    "Canal + Tubewell",
    "Loam",
  ),
  seed(
    "AP-PB-0246",
    0,
    "Aslam West Field",
    P,
    [
      [491, 463],
      [571, 448],
      [588, 514],
      [509, 528],
    ],
    "Maize",
    "Tubewell",
    "Loam",
  ),
  seed(
    "AP-KP-0101",
    5,
    "Rahman Maize Field",
    K,
    [
      [421, 212],
      [519, 201],
      [553, 277],
      [463, 302],
    ],
    "Maize",
    "Canal + Tubewell",
    "Sandy loam",
  ),
  seed(
    "AP-KP-0102",
    6,
    "Samina North Field",
    K,
    [
      [236, 98],
      [325, 82],
      [347, 147],
      [251, 173],
    ],
    "Vegetables",
    "Canal",
    "Silt loam",
  ),
  seed(
    "AP-KP-0103",
    6,
    "Samina Lower Field",
    K,
    [
      [648, 339],
      [729, 307],
      [756, 381],
      [670, 417],
    ],
    "Wheat",
    "Canal",
    "Loam",
  ),
];

export function localWeather(field: Field) {
  const baseline = demoRegion(field.region);
  const offset =
    field.village === baseline.village
      ? 0
      : (field.village.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5) - 2;
  return {
    ...baseline,
    temperature: baseline.temperature + offset,
    humidity: baseline.humidity - offset * 2,
    rain: Math.max(0, baseline.rain - offset * 2),
    eto: +(baseline.eto + offset * 0.15).toFixed(1),
    forecasts: baseline.forecasts.map((t) => t + offset),
  };
}

export const acres = (value: number) =>
  value.toLocaleString("en-PK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const number = (value: number) => Math.round(value).toLocaleString("en-PK");
export const pkr = (value: number) => `PKR ${number(value)}`;

export const forecastDays = ["20 Mar", "21 Mar", "22 Mar", "23 Mar", "24 Mar", "25 Mar", "26 Mar"];
export type SelectField = (id: string, page?: Page) => void;
