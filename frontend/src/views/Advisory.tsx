"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCheck,
  CloudRain,
  Database,
  Mail,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { localWeather, pkr, regionData } from "@/domain/data";
import type { Farmer, Field } from "@/domain/data";
import { Button, Card, Chip, Demo, Empty, PageTitle } from "@/components/ui";

export type AdvisoryLog = Record<
  string,
  {
    stage: "new" | "processing" | "missing" | "review" | "sent" | "error";
    fieldId?: string;
    reply?: string;
  }
>;

export default function Advisory({
  farmers,
  fields,
  farmer,
  pick,
  log,
  setLog,
  onApprove,
  notify,
}: {
  farmers: Farmer[];
  fields: Field[];
  farmer?: Farmer;
  pick: (id: string) => void;
  log: AdvisoryLog;
  setLog: (id: string, stage: AdvisoryLog[string]) => void;
  onApprove: (farmer: Farmer, field: Field, reply: string) => void;
  notify: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [forceError, setForceError] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const owners = farmers.filter((f) =>
    `${f.name} ${f.village} ${regionData[f.region].district}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const plots = fields.filter((f) => f.farmerId === farmer?.id);
  const state: AdvisoryLog[string] = farmer
    ? (log[farmer.id] ?? { stage: "new" })
    : { stage: "new" };
  const automatic =
    farmer?.id === "FMR-0108"
      ? plots.find((f) => f.crop === "Wheat")
      : plots.length === 1
        ? plots[0]
        : undefined;
  const field =
    plots.find((f) => f.id === (farmer ? overrides[farmer.id] || state.fieldId : undefined)) ??
    automatic;
  const map = field ? localWeather(field) : farmer ? regionData[farmer.region] : undefined;
  const usedPump = farmer?.id === "FMR-0108" || Boolean(field?.source.includes("Tubewell"));
  const depth = field && usedPump ? (320 / (field.acres * 4.0468564)).toFixed(1) : undefined;
  const reply =
    field && map
      ? `Thank you for reporting your irrigation${usedPump ? " by tubewell" : ""}. We recorded it for ${field.name}. ${depth ? `Two hours would deliver about ${depth} mm if the pump discharged at the demo rate and covered the whole field. ` : "We did not have enough information to estimate the water applied. "}With ${map.rain} mm in the illustrative forecast${field.source.includes("Canal") ? ` and a provisional canal turn on ${map.canalDay}, the modeled next step is to reassess before scheduling more pumping` : ", the modeled next step is to reassess after the forecast rain"}. Please confirm field moisture and water availability with your officer. This is a simulated advisory, not an irrigation instruction.`
      : "";
  const process = () => {
    if (!farmer) return;
    const id = farmer.id;
    setLog(id, { stage: "processing", fieldId: field?.id });
    window.setTimeout(
      () =>
        setLog(id, field ? { stage: "review", fieldId: field.id, reply } : { stage: "missing" }),
      650,
    );
  };
  return (
    <>
      <PageTitle
        eyebrow="FARMER COMMUNICATIONS"
        title="AI Advisory Center"
        description="Review reported field activity and approve personalized replies before they are sent."
      >
        <Demo>Simulated email channel</Demo>
      </PageTitle>
      <div className="advisory-grid card">
        <aside className="conversation-list">
          <div className="conversation-list-head">
            <h2>Conversations</h2>
            <label className="label-inline search">
              <Search size={15} />
              <input
                aria-label="Search conversations"
                placeholder="Search conversations…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
          {owners.map((f) => (
            <button
              className={`conversation-option ${farmer?.id === f.id ? "active" : ""}`}
              key={f.id}
              onClick={() => {
                pick(f.id);
                setForceError(false);
              }}
            >
              <span className="avatar">
                {f.name
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")}
              </span>
              <span>
                <strong>{f.name}</strong>
                <small>
                  {regionData[f.region].district} ·{" "}
                  {fields.find((p) => p.farmerId === f.id)?.crop ?? "No field"}
                </small>
                <em>
                  {log[f.id]?.stage === "sent"
                    ? "Advisory sent"
                    : log[f.id]?.stage === "review"
                      ? "Awaiting officer review"
                      : "New farmer report"}
                </em>
              </span>
              {log[f.id]?.stage !== "sent" && <i />}
            </button>
          ))}
          {!owners.length && (
            <Empty title="No conversations" text="Search by farmer or district." />
          )}
        </aside>
        {farmer && map ? (
          <section className="conversation">
            <header>
              <div className="avatar large">
                {farmer.name
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")}
              </div>
              <div>
                <h2>{farmer.name}</h2>
                <p>
                  {farmer.email || "Email not provided"} · {map.district}
                </p>
              </div>
              <Chip tone="blue">
                <Mail size={13} /> Email prototype
              </Chip>
            </header>
            <div className="conversation-body">
              <div className="day-divider">20 March 2026</div>
              <div className="chat-bubble incoming">
                <strong>Incoming farmer email</strong>
                <p>
                  {farmer.id === "FMR-0108"
                    ? "I used my tubewell yesterday for two hours. When should I water my wheat again?"
                    : usedPump
                      ? "I ran my tubewell for two hours yesterday. Can you help me plan the next irrigation?"
                      : "I irrigated yesterday. Can you check when my field may need water again?"}
                </p>
                <small>09:14 · Received</small>
              </div>
              <div className="notice weather-conversation">
                <CloudRain size={19} />
                <span>
                  <strong>Local forecast · {map.district}</strong>
                  <br />
                  {map.rain} mm of rainfall in the synthetic forecast. Weather and fertilizer
                  reminders remain subject to officer review.
                </span>
              </div>
              {state.stage === "new" && (
                <Button variant="primary" onClick={process}>
                  <Sparkles size={16} /> Analyze farmer email
                </Button>
              )}
              {state.stage === "processing" && (
                <div className="notice" role="status">
                  <Sparkles size={18} />
                  <span>
                    Analyzing the report, matching field records, and preparing a demonstration
                    advisory…
                  </span>
                </div>
              )}
              {state.stage === "missing" && (
                <Card title="Field confirmation needed" action={<AlertCircle size={18} />}>
                  {plots.length ? (
                    <>
                      <p className="body-copy">
                        The report does not identify a unique field. Choose which field the farmer
                        irrigated.
                      </p>
                      <div className="filters">
                        <select
                          aria-label="Confirm farmer field"
                          value={farmer ? overrides[farmer.id] || "" : ""}
                          onChange={(e) =>
                            setOverrides({ ...overrides, [farmer.id]: e.target.value })
                          }
                        >
                          <option value="">Select a field</option>
                          {plots.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <Button variant="primary" onClick={process} disabled={!field}>
                          Continue <ArrowRight size={16} />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="body-copy">
                      This farmer does not have a mapped field. Register a field before running the
                      analysis.
                    </p>
                  )}
                </Card>
              )}
              {(state.stage === "review" || state.stage === "error") && field && (
                <Card
                  title="Officer review & approval"
                  subtitle="The field history is updated only after approval."
                  action={
                    <Chip tone="amber" dot>
                      Needs review
                    </Chip>
                  }
                >
                  <div className="extraction">
                    <div>
                      <Database size={16} />
                      <span>
                        <strong>Matched field and retrieved records</strong>
                        <small>
                          {field.name} · {field.id} · {field.crop} · {field.stage}
                        </small>
                      </span>
                    </div>
                    <div>
                      <Sparkles size={16} />
                      <span>
                        <strong>Proposed irrigation entry</strong>
                        <small>
                          19 Mar 2026 ·{" "}
                          {usedPump
                            ? `Tubewell, reported 2 hours · ${pkr(field.rate * 2)} estimated pumping`
                            : "Duration and method unconfirmed"}{" "}
                          · farmer reported
                        </small>
                      </span>
                    </div>
                  </div>
                  <div className="chat-bubble outgoing">
                    <strong>Draft advisory · simulated AI</strong>
                    <p>{state.reply}</p>
                  </div>
                  {state.stage === "error" && (
                    <div className="notice error" role="alert">
                      <AlertCircle size={18} />
                      <span>
                        {farmer.email
                          ? "Simulated delivery failed. Turn off the failure test and retry."
                          : "An email address is required. No reply or field update was recorded."}
                      </span>
                    </div>
                  )}
                  <div className="review-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={forceError}
                        onChange={(e) => setForceError(e.target.checked)}
                      />{" "}
                      Simulate delivery failure
                    </label>
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (!farmer.email || forceError)
                          setLog(farmer.id, { ...state, stage: "error" });
                        else {
                          onApprove(farmer, field, state.reply || reply);
                          notify("Demo advisory sent and field history updated.");
                        }
                      }}
                    >
                      <Send size={15} />{" "}
                      {state.stage === "error" ? "Retry demo send" : "Approve & Send"}
                    </Button>
                  </div>
                </Card>
              )}
              {state.stage === "sent" && (
                <>
                  <div className="chat-bubble outgoing">
                    <strong>Officer-approved advisory</strong>
                    <p>{state.reply}</p>
                    <small>
                      <CheckCheck size={15} /> 09:26 · Delivered in demo
                    </small>
                  </div>
                  <div className="notice">
                    <Check size={18} />
                    <span>
                      Irrigation event added to the selected field history. No actual email was
                      sent.
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : (
          <Empty title="Select a farmer" text="Open a conversation to review farmer reports." />
        )}
      </div>
    </>
  );
}
