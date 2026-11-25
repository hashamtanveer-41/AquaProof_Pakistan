import type { Field, Point } from "@/domain/data";
import { polygon } from "@/domain/registry";
import { validMapPoint, validParcel } from "./parcel";

export async function readBoundary(file: File): Promise<Point[]> {
  if (file.size > 2_000_000) throw new Error("Boundary files must be under 2 MB.");
  const text = await file.text();
  let ring: unknown;
  if (file.name.toLowerCase().endsWith(".kml")) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const polygons = xml.getElementsByTagNameNS("*", "Polygon");
    const boundaries = polygons[0]?.getElementsByTagNameNS("*", "LinearRing");
    const coordinates = boundaries?.[0]?.getElementsByTagNameNS("*", "coordinates")[0]?.textContent;
    if (
      !xml.doctype &&
      !xml.querySelector("parsererror") &&
      polygons.length === 1 &&
      boundaries?.length === 1 &&
      coordinates?.trim()
    ) {
      ring = coordinates
        .trim()
        .split(/\s+/)
        .map((entry) => {
          const [x, y] = entry.split(",");
          return [x?.trim() ? Number(x) : NaN, y?.trim() ? Number(y) : NaN];
        });
    }
  } else {
    let geometry = JSON.parse(text);
    if (geometry?.type === "FeatureCollection" && geometry.features?.length === 1)
      geometry = geometry.features[0];
    if (geometry?.type === "Feature") geometry = geometry.geometry;
    if (geometry?.type === "Polygon" && geometry.coordinates?.length === 1)
      ring = geometry.coordinates[0];
  }
  if (
    !Array.isArray(ring) ||
    ring.length < 4 ||
    ring.length > 5001 ||
    !ring.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((value) => typeof value === "number") &&
        validMapPoint(point as Point),
    ) ||
    ring[0][0] !== ring.at(-1)[0] ||
    ring[0][1] !== ring.at(-1)[1] ||
    !validParcel(ring.slice(0, -1))
  ) {
    throw new Error("Import one valid closed WGS84 polygon without holes or overlapping edges.");
  }
  const points = ring.slice(0, -1) as Point[];
  const { ValidateNotSelfIntersecting } = await import("terra-draw");
  if (
    !ValidateNotSelfIntersecting({ type: "Feature", geometry: polygon(points), properties: {} })
      .valid
  ) {
    throw new Error("Boundary edges must not cross.");
  }
  return points;
}

export function exportBoundaries(fields: Field[], format: "geojson" | "kml") {
  const data =
    format === "geojson"
      ? JSON.stringify(
          {
            type: "FeatureCollection",
            features: fields.map(({ id, name, acres, points }) => ({
              type: "Feature",
              geometry: polygon(points),
              properties: { id, name, acres },
            })),
          },
          null,
          2,
        )
      : (() => {
          const xml = document.implementation.createDocument(
            "http://www.opengis.net/kml/2.2",
            "kml",
          );
          function add(parent: Element, tag: string, value?: string) {
            const element = xml.createElementNS(xml.documentElement.namespaceURI, tag);
            if (value !== undefined) element.textContent = value;
            return parent.appendChild(element);
          }
          const body = add(xml.documentElement, "Document");
          for (const { name, points } of fields) {
            const place = add(body, "Placemark");
            add(place, "name", name);
            const ring = add(add(add(place, "Polygon"), "outerBoundaryIs"), "LinearRing");
            add(
              ring,
              "coordinates",
              polygon(points)
                .coordinates[0].map(([x, y]) => `${x},${y}`)
                .join(" "),
            );
          }
          return new XMLSerializer().serializeToString(xml);
        })();
  const url = URL.createObjectURL(
    new Blob([data], {
      type: format === "geojson" ? "application/geo+json" : "application/vnd.google-earth.kml+xml",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "aquaproof-boundaries." + format;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
