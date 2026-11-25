"use client";

import { Globe2 } from "lucide-react";
import { Card, Chip, Demo, Details, PageTitle } from "@/components/ui";
import { useWorkspace } from "@/context/WorkspaceContext";
import { connected } from "@/domain/registry";

export default function SettingsPage() {
  const { district, rtl, setRtl, large, setLarge } = useWorkspace();

  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE PREFERENCES"
        title="Settings"
        description="Configure your demonstration workspace and review its data policy."
      >
        <Demo />
      </PageTitle>
      <div className="grid-2">
        <Card title="Officer profile" action={<Chip dot>Demo account</Chip>}>
          <Details
            rows={[
              ["Name", "Ayesha Khan"],
              ["Role", "Agriculture Officer"],
              ["Department", "Agriculture Department"],
              ["Current district", district.district],
            ]}
          />
        </Card>
        <Card title="Accessibility & localization" action={<Globe2 size={19} />}>
          <div className="settings-toggles">
            <label>
              <span>
                <strong>Right-to-left layout preview</strong>
                <small>Test future Urdu layout. Interface copy remains in English.</small>
              </span>
              <input type="checkbox" checked={rtl} onChange={(e) => setRtl(e.target.checked)} />
            </label>
            <label>
              <span>
                <strong>Increase text size</strong>
                <small>Increase the size of workspace content.</small>
              </span>
              <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />
            </label>
          </div>
        </Card>
      </div>
      <Card title="Help & data policy">
        <p className="body-copy">
          {connected ? (
            "Registry changes, crop seasons, and correspondence are saved to the connected database."
          ) : (
            <>
              AquaProof uses synthetic records, demonstration imagery, and simulated advisory
              delivery. Changes are held only for this browser tab session and reset on reload. Use
              the Farm Map to register fields, Irrigation Intelligence to compare scenarios, and AI
              Advisory Center for officer-reviewed replies.
            </>
          )}
        </p>
      </Card>
    </>
  );
}
