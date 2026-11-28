import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Chip } from "@/components/ui";
import type { Field } from "@/domain/data";
import { request } from "@/domain/registry";

type Language = "en" | "ur" | "roman_ur";
type Message = {
  id: string;
  kind: string;
  direction: string;
  status: string;
  body: string;
  review_reason?: string;
  created_at: string;
  whatsapp_transport: "waha" | "green_api" | null;
  evidence: Record<string, unknown>;
  usage: { calls?: unknown[] };
};
type Observation = {
  id: number;
  status: string;
  measurements: Record<string, unknown>;
};
type Monitor = {
  identity: { language: Language; verified_at: string | null } | null;
  messages: Message[];
  observations: Observation[];
  jobs: { id: number; kind: string; status: string; attempt: number; error: string | null }[];
  usage: { calls: number; priced_calls: number; cost_usd: number | null };
};

export function AssistantMonitor({ field }: { field: Field }) {
  const path = "/assistant/fields/" + encodeURIComponent(field.id);
  const [enabled, setEnabled] = useState<boolean>();
  const [configured, setConfigured] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [worker, setWorker] = useState(false);
  const [monitor, setMonitor] = useState<Monitor>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<Language>("ur");

  useEffect(() => {
    let current = true;
    request<{
      enabled: boolean;
      model_configured: boolean;
      whatsapp_configured: boolean;
      whatsapp_worker_enabled: boolean;
    }>("/assistant/status")
      .then((data) => {
        if (!current) return;
        setEnabled(data.enabled);
        setConfigured(data.model_configured);
        setWhatsapp(data.whatsapp_configured);
        setWorker(data.whatsapp_worker_enabled);
      })
      .catch(() => {
        if (current) setStatus("Assistant status could not be loaded.");
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    request<Monitor>(path)
      .then((data) => {
        if (!current) return;
        setMonitor(data);
        setLanguage(data.identity?.language ?? "ur");
      })
      .catch((error) => {
        if (current)
          setStatus(error instanceof Error ? error.message : "Monitoring is unavailable.");
      });
    return () => {
      current = false;
    };
  }, [enabled, path, revision]);

  function reload() {
    setMonitor(undefined);
    setRevision((value) => value + 1);
  }

  async function submit(endpoint: string, values: unknown) {
    if (busy) return false;
    setStatus("");
    setBusy(true);
    try {
      const result = await request<{ status: string }>(path + endpoint, "POST", values);
      setStatus(result.status);
      reload();
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The officer action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>, message: Message) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void submit("/messages/" + message.id + "/review", {
      action: values.get("action"),
      note: values.get("note"),
      replacement: String(values.get("replacement") ?? "").trim() || null,
    });
  }

  const identity = monitor?.identity;
  const usage = monitor?.usage;
  return (
    <Card
      title="Agricultural assistant"
      subtitle="WhatsApp enrollment, daily advisories and officer review."
      action={
        <Button
          disabled={busy || !enabled}
          onClick={() => {
            setStatus("");
            reload();
          }}
        >
          Refresh assistant
        </Button>
      }
    >
      {status && <p role="status">{status}</p>}
      {enabled === undefined && !status && <p>Loading assistant status...</p>}
      {enabled === false && (
        <p>The assistant is disabled in this environment. WhatsApp messaging is paused.</p>
      )}
      {enabled && !whatsapp && (
        <p>Configure the WAHA session and webhook to enable WhatsApp messaging.</p>
      )}
      {enabled && whatsapp && !worker && (
        <p>The WhatsApp worker is paused. Messages stay in the queue.</p>
      )}
      {enabled && (
        <>
          {!configured && (
            <p>Groq model access is unconfigured. The assistant uses verified templates.</p>
          )}
          {monitor ? (
            <>
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit("/enroll", { language });
                }}
              >
                <label>
                  Farmer's preferred language
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value as Language)}
                  >
                    <option value="ur">Urdu</option>
                    <option value="roman_ur">Roman Urdu</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <p>
                  {identity?.verified_at
                    ? "Verified WhatsApp number"
                    : identity
                      ? "Awaiting WhatsApp verification"
                      : "Farmer is not enrolled"}
                </p>
                <Button type="submit" disabled={busy || !whatsapp}>
                  {identity?.verified_at ? "Save preferred language" : "Send WhatsApp verification"}
                </Button>
              </form>
              {identity?.verified_at && (
                <form
                  className="form-grid"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const body = String(new FormData(form).get("body") ?? "");
                    if (await submit("/messages", { body, request_id: crypto.randomUUID() }))
                      form.reset();
                  }}
                >
                  <label className="full-line">
                    Officer message
                    <textarea name="body" required maxLength={1800} />
                  </label>
                  <Button type="submit" disabled={busy || !whatsapp}>
                    Queue WhatsApp message
                  </Button>
                </form>
              )}
              {usage && (
                <p>
                  Model calls recorded: {usage.calls} · Priced calls: {usage.priced_calls} ·
                  Reported cost:{" "}
                  {usage.cost_usd == null
                    ? "Unavailable"
                    : "USD " + Number(usage.cost_usd).toFixed(6)}
                </p>
              )}
              <section className="assistant-monitor">
                <h3>Processing queue</h3>
                {monitor.jobs.length ? (
                  <ul>
                    {monitor.jobs.map((job) => (
                      <li key={job.id}>
                        {job.kind} · {job.status} · attempts {job.attempt}
                        {job.error ? " · " + job.error : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No assistant jobs yet.</p>
                )}
                <h3>Messages and advisories</h3>
                {monitor.messages.length ? (
                  monitor.messages.map((message) => (
                    <article className="card surface" key={message.id}>
                      <div className="weather-source">
                        <strong>
                          {message.kind} · {message.direction}
                        </strong>
                        <Chip tone={message.status === "review" ? "amber" : "neutral"}>
                          {message.status === "sent"
                            ? message.whatsapp_transport === "waha"
                              ? "Accepted by WAHA"
                              : "Accepted by WhatsApp provider"
                            : message.status}
                        </Chip>
                        <time dateTime={message.created_at}>
                          {new Date(message.created_at).toLocaleString()}
                        </time>
                      </div>
                      {message.review_reason && <p>{message.review_reason}</p>}
                      <p className="live-message" dir="auto">
                        {message.body}
                      </p>
                      {Object.keys(message.evidence).length > 0 && (
                        <details>
                          <summary>Recommendation evidence, uncertainty and data sources</summary>
                          <pre>{JSON.stringify(message.evidence, null, 2)}</pre>
                        </details>
                      )}
                      {(message.status === "review" || message.status === "failed") && (
                        <form className="form-grid" onSubmit={(event) => review(event, message)}>
                          <label>
                            Officer action
                            <select name="action" defaultValue="approve">
                              <option value="approve">Approve delivery</option>
                              <option value="reject">Reject</option>
                              <option value="override">Send an officer override</option>
                            </select>
                          </label>
                          <label>
                            Review note
                            <input name="note" minLength={3} maxLength={400} required />
                          </label>
                          <label className="full-line">
                            Replacement text for an override
                            <textarea name="replacement" maxLength={1800} rows={2} />
                          </label>
                          <Button type="submit" disabled={busy}>
                            Save message review
                          </Button>
                        </form>
                      )}
                    </article>
                  ))
                ) : (
                  <p>No assistant messages yet.</p>
                )}
                <h3>Farmer observations</h3>
                {monitor.observations.length ? (
                  monitor.observations.map((observation) => (
                    <article className="card surface" key={observation.id}>
                      <Chip>{observation.status}</Chip>
                      <pre>{JSON.stringify(observation.measurements, null, 2)}</pre>
                      {observation.status === "review" && (
                        <form
                          className="form-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const values = new FormData(event.currentTarget);
                            void submit("/observations/" + observation.id + "/review", {
                              action: values.get("action"),
                              note: values.get("note"),
                            });
                          }}
                        >
                          <label>
                            Observation decision
                            <select name="action">
                              <option value="approved">Accept report</option>
                              <option value="rejected">Reject report</option>
                            </select>
                          </label>
                          <label>
                            Review note
                            <input name="note" minLength={3} maxLength={400} required />
                          </label>
                          <Button type="submit" disabled={busy}>
                            Save observation review
                          </Button>
                        </form>
                      )}
                    </article>
                  ))
                ) : (
                  <p>No field reports yet.</p>
                )}
              </section>
            </>
          ) : (
            <p role="status">{status ? "Refresh to try again." : "Loading assistant activity…"}</p>
          )}
        </>
      )}
    </Card>
  );
}
