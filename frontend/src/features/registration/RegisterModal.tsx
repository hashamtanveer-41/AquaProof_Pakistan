import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, UserRoundPlus, X } from "lucide-react";
import { acres, measure, regionData, regions } from "@/domain/data";
import type { Farmer, Field, Point, Region } from "@/domain/data";
import { Button, Demo } from "@/components/ui";

export type Registration = { points?: Point[]; owner?: string };

export function RegisterModal({
  model,
  region,
  farmers,
  close,
  save,
}: {
  model: Registration;
  region: Region;
  farmers: Farmer[];
  close: () => void;
  save: (owner: Farmer, field?: Pick<Field, "name" | "crop" | "soil" | "source">) => void;
}) {
  const [ownerId, setOwnerId] = useState(model.owner ?? "");
  const [province, setProvince] = useState<Region>(region);
  const dialog = useRef<HTMLDialogElement>(null);
  const points = model.points;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const formRegion = points ? region : province;
  const options = farmers.filter((f) => f.region === formRegion);
  return (
    <dialog
      ref={dialog}
      className="register-modal card"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const val = (name: string) => String(values.get(name) ?? "").trim();
          const existing = options.find((f) => f.id === ownerId);
          const name = existing?.name ?? val("name");
          if (!name || (points && !val("field"))) return;
          save(
            existing ?? {
              id: "",
              name,
              email: val("email"),
              phone: val("phone"),
              village: val("village") || regionData[formRegion].village,
              region: formRegion,
            },
            points
              ? { name: val("field"), crop: val("crop"), soil: val("soil"), source: val("source") }
              : undefined,
          );
        }}
      >
        <div className="modal-heading">
          <span className="stat-icon">
            {points ? <MapPin size={22} /> : <UserRoundPlus size={22} />}
          </span>
          <button
            type="button"
            className="bare-button"
            onClick={close}
            aria-label="Close registration"
          >
            <X size={20} />
          </button>
        </div>
        <h2>{points ? "Save farm boundary" : "Register a farmer"}</h2>
        <p>
          {points
            ? `Link the mapped ${acres(measure(points))}-acre field to a farmer in ${regionData[region].district}.`
            : "Add a farmer to the demo registry. You can link fields from the Farm Map."}
        </p>
        {points && (
          <label>
            Link to farmer
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Register a new farmer</option>
              {options.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {!ownerId && (
          <div className="form-grid">
            <label className="full-line">
              Farmer name
              <input
                name="name"
                placeholder="Full name"
                autoComplete="off"
                required
                pattern=".*\S.*"
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                placeholder="farmer@example.com"
                autoComplete="off"
              />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" placeholder="+92 300 000 0000" autoComplete="off" />
            </label>
            {points ? (
              <label>
                District
                <input value={`${regionData[region].district}, ${region}`} readOnly />
              </label>
            ) : (
              <label>
                Province
                <select value={province} onChange={(e) => setProvince(e.target.value as Region)}>
                  {regions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Village
              <input
                name="village"
                key={formRegion}
                defaultValue={regionData[formRegion].village}
                required
                pattern=".*\S.*"
              />
            </label>
          </div>
        )}
        {points && (
          <div className="form-grid field-form">
            <label className="full-line">
              Field name
              <input name="field" placeholder="e.g. North Wheat Field" required pattern=".*\S.*" />
            </label>
            <label>
              Crop
              <select name="crop">
                {["Wheat", "Maize", "Rice", "Sugarcane", "Vegetables"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Soil type
              <select name="soil">
                {["Loam", "Sandy loam", "Silt loam", "Clay loam"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="full-line">
              Irrigation source
              <select name="source">
                {["Canal + Tubewell", "Canal", "Tubewell", "Rain-fed"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <footer>
          <Demo>Session-only record</Demo>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            {points ? "Save Farm" : "Register Farmer"} <ArrowRight size={15} />
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
