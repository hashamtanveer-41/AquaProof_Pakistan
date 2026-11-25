import { mapServerRequest } from "@/domain/registry";

export type Basemap = "street" | "satellite" | "hybrid";
export type ArcGISConfig = {
  browser_token: string | null;
  digitization_authorized: boolean;
  server_basemaps?: boolean;
};

const arcgisStyles: Record<Basemap, string> = {
  street: "streets",
  satellite: "imagery/standard",
  hybrid: "imagery",
};

export function arcgisStyle(basemap: Basemap) {
  return (
    "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/" +
    arcgisStyles[basemap]
  );
}

export function arcgisRequest(url: string, token?: string | null) {
  if (url.startsWith("/api/map/basemap-style/") || url.startsWith("/api/map/basemap-assets/")) {
    return mapServerRequest(url);
  }
  if (!token || !url.startsWith("https://")) return { url };
  const target = new URL(url);
  const trusted =
    target.hostname === "basemapstyles-api.arcgis.com" ||
    /^(?:ibasemaps|basemaps|static-map-tiles)(?:-api)?\.arcgis\.com$/.test(target.hostname);
  if (
    !trusted ||
    target.port ||
    target.username ||
    target.password ||
    target.searchParams.has("token")
  ) {
    return { url };
  }
  return { url: url + (target.search ? "&" : "?") + "token=" + encodeURIComponent(token) };
}
