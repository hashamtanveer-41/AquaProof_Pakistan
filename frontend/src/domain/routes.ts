import type { Page } from "./data";

export const PAGE_ROUTES: Record<Exclude<Page, "profile">, string> = {
  overview: "/overview",
  map: "/map",
  registry: "/registry",
  crops: "/crops",
  irrigation: "/irrigation",
  weather: "/weather",
  advisory: "/advisory",
  reports: "/reports",
  settings: "/settings",
};

export function pageFromPathname(pathname: string): Page {
  if (pathname.startsWith("/farmers/")) return "profile";
  const match = (Object.entries(PAGE_ROUTES) as [Exclude<Page, "profile">, string][]).find(
    ([, path]) => pathname === path || pathname.startsWith(`${path}/`),
  );
  return match ? match[0] : "map";
}
