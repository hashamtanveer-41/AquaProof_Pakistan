import { lazy, Suspense } from "react";
import type { LiveMapProps } from "./LiveMap";

const LiveMap = lazy(() => import("./LiveMap"));

export function GeoCanvas(props: LiveMapProps) {
  return (
    <Suspense
      fallback={
        <div className="geo-canvas" role="status">
          Loading map…
        </div>
      }
    >
      <LiveMap {...props} />
    </Suspense>
  );
}
