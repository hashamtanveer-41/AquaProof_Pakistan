import { Sprout } from "lucide-react";
import { regionData } from "@/domain/data";
import type { Field } from "@/domain/data";

export function FieldSelect({
  fields,
  id,
  onChange,
}: {
  fields: Field[];
  id: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="label-inline">
      <Sprout size={16} />
      <select aria-label="Selected field" value={id} onChange={(e) => onChange(e.target.value)}>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} · {regionData[f.region].district}
          </option>
        ))}
      </select>
    </label>
  );
}
