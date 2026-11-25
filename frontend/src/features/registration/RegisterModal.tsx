import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, UserRoundPlus, X } from "lucide-react";
import type { Farmer, Field, Point, Region } from "@/domain/data";
import { Button } from "@/components/ui";

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
  save: (owner: Farmer, field?: Pick<Field, "name" | "crop" | "soil" | "source">) => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState(model.owner ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const points = model.points;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="register-modal card"
      aria-labelledby="registration-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
      onClick={(event) => {
        if (!saving && event.target === event.currentTarget) close();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          const values = new FormData(event.currentTarget);
          const val = (name: string) => String(values.get(name) ?? "").trim();
          const existing = farmers.find((f) => f.id === ownerId);
          const name = existing?.name ?? val("name");
          if (!name || (points && !val("field"))) return;
          setSaving(true);
          setError("");
          try {
            await save(
              existing ?? {
                id: "",
                name,
                email: "",
                phone: val("phone"),
                village: val("village"),
                region: val("region"),
                district: val("district") || null,
                tehsil: val("tehsil") || null,
              },
              points
                ? {
                    name: val("field"),
                    crop: val("crop"),
                    soil: val("soil"),
                    source: val("source"),
                  }
                : undefined,
            );
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "Registration could not be saved.",
            );
          } finally {
            setSaving(false);
          }
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
            disabled={saving}
            aria-label="Close registration"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="registration-title">{points ? "Save farm boundary" : "Register a farmer"}</h2>
        <p>
          {points
            ? "Link this field to a farmer. The saved boundary determines its area."
            : "Add a farmer to the registry. You can link fields from the Farm Map."}
        </p>
        {error && <p role="alert">{error}</p>}
        {points && (
          <label>
            Link to farmer
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Register a new farmer</option>
              {farmers.map((f) => (
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
              WhatsApp phone
              <input
                name="phone"
                type="tel"
                placeholder="+92 300 000 0000"
                autoComplete="off"
                required
              />
            </label>
            <label>
              Province or region
              <input name="region" defaultValue={region} maxLength={160} required />
            </label>
            <label>
              District
              <input name="district" maxLength={160} />
            </label>
            <label>
              Tehsil
              <input name="tehsil" maxLength={160} />
            </label>
            <label>
              Village
              <input name="village" required pattern=".*\S.*" />
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
                {["Wheat", "Maize", "Rice", "Cotton", "Sugarcane", "Vegetables"].map((c) => (
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
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {points ? "Save Farm" : "Register Farmer"} <ArrowRight size={15} />
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
