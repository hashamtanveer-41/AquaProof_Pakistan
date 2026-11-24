import { useEffect, useState } from "react";
import { Button, Card, Empty, PageTitle } from "@/components/ui";
import type { Field } from "@/domain/data";
import { fetchField, request } from "@/domain/registry";
import { AssistantMonitor } from "./AssistantMonitor";

type Advisory = {
  id: number;
  subject: string;
  body: string;
  scheduled_at: string;
  sent_at: string | null;
  failed_at: string | null;
};
type Reply = {
  id: number;
  advisory_id: number;
  body: string;
  status: "pending" | "review" | "unavailable";
  approved_at: string | null;
  parsed: {
    source: string | null;
    duration_minutes: number | null;
    irrigation_date: string | null;
  } | null;
};
type History = { advisories: Advisory[]; replies: Reply[]; parser_enabled: boolean };

export default function LiveAdvisory({
  fields,
  selectedFieldId,
  onFieldUpdated,
  openMap,
}: {
  fields: Field[];
  selectedFieldId?: string;
  onFieldUpdated: (field: Field) => void;
  openMap: () => void;
}) {
  const [selection, setSelection] = useState("");
  const field = fields.find((item) => item.id === (selection || selectedFieldId)) ?? fields[0];
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<{ id: string; revision: number; history: History }>();
  const history =
    saved?.id === field?.id && saved?.revision === revision ? saved.history : undefined;
  const [historyError, setHistoryError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldId = field?.id;
  useEffect(() => {
    if (!fieldId) return;
    let active = true;
    let timer: number;
    setHistoryError("");
    const refresh = async () => {
      try {
        const result = await request<History>(`/fields/${encodeURIComponent(fieldId)}/advisories`);
        if (!active) return;
        setSaved({ id: fieldId, revision, history: result });
        setHistoryError("");
      } catch {
        if (!active) return;
        setSaved(undefined);
        setHistoryError("Could not load the conversation.");
      } finally {
        if (active) timer = window.setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fieldId, revision]);

  async function submit(path: string, data?: unknown) {
    setBusy(true);
    setStatus("");
    try {
      await request(path, "POST", data);
      setRevision((current) => current + 1);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="FARMER COMMUNICATIONS"
        title="Advisory Center"
        description="Approve email delivery and review farmer replies for each field."
      />
      {!field ? (
        <Empty
          title="No registered fields"
          text="Register a field to start a conversation."
          action={<Button onClick={openMap}>Open Farm Map</Button>}
        />
      ) : (
        <>
          <AssistantMonitor key={field.id} field={field} />
          <Card title="Approve an advisory">
            <form
              className="form-grid"
              key={field.id}
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                const schedule = String(data.get("schedule"));
                if (
                  await submit("/advisories", {
                    field_id: field.id,
                    subject: data.get("subject"),
                    body: data.get("body"),
                    scheduled_at: schedule ? new Date(schedule).toISOString() : null,
                  })
                )
                  form.reset();
              }}
            >
              <label>
                Field
                <select
                  value={field.id}
                  disabled={busy}
                  onChange={(event) => {
                    setSelection(event.target.value);
                    setStatus("");
                  }}
                >
                  {fields.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.village}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Send at (local time)
                <input name="schedule" type="datetime-local" />
              </label>
              <label className="full-line">
                Subject
                <input name="subject" required maxLength={160} />
              </label>
              <label className="full-line">
                Message
                <textarea name="body" rows={5} required maxLength={8000} />
              </label>
              <button className="button" disabled={busy}>
                Approve and queue
              </button>
              {status && <p role="status">{status}</p>}
            </form>
          </Card>
          <Card
            title="Conversation history"
            action={
              <Button
                onClick={() => {
                  setHistoryError("");
                  setRevision((current) => current + 1);
                }}
              >
                Refresh conversation
              </Button>
            }
          >
            {!history ? (
              <p role="status">{historyError || "Loading conversation…"}</p>
            ) : history.advisories.length ? (
              history.advisories.map((advisory) => (
                <article className="card surface" key={advisory.id}>
                  <h3>{advisory.subject}</h3>
                  <p className="live-message">{advisory.body}</p>
                  <p>
                    {advisory.sent_at
                      ? `Sent ${new Date(advisory.sent_at).toLocaleString()}`
                      : advisory.failed_at
                        ? "Delivery failed"
                        : `Queued for ${new Date(advisory.scheduled_at).toLocaleString()}`}
                  </p>
                  {advisory.failed_at && (
                    <button
                      className="text-action"
                      disabled={busy}
                      onClick={() => void submit(`/advisories/${advisory.id}/send`)}
                    >
                      Retry delivery
                    </button>
                  )}
                  {advisory.sent_at && (
                    <form
                      className="form-grid"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const data = new FormData(form);
                        if (
                          await submit("/messages/inbound", {
                            advisory_id: advisory.id,
                            message_id: crypto.randomUUID(),
                            body: data.get("reply"),
                          })
                        )
                          form.reset();
                      }}
                    >
                      <label className="full-line">
                        Record a farmer reply
                        <textarea name="reply" rows={3} required maxLength={8000} />
                      </label>
                      <button className="button" disabled={busy}>
                        Record reply
                      </button>
                    </form>
                  )}
                  {history.replies
                    .filter((reply) => reply.advisory_id === advisory.id)
                    .map((reply) => (
                      <div key={reply.id}>
                        <h4>{reply.approved_at ? "Approved farmer reply" : "Farmer reply"}</h4>
                        <p className="live-message">{reply.body}</p>
                        {reply.parsed ? (
                          <dl>
                            <dt>Irrigation source</dt>
                            <dd>{reply.parsed.source ?? "Unreported"}</dd>
                            <dt>Duration in minutes</dt>
                            <dd>{reply.parsed.duration_minutes ?? "Unreported"}</dd>
                            <dt>Irrigation date</dt>
                            <dd>{reply.parsed.irrigation_date ?? "Unreported"}</dd>
                          </dl>
                        ) : (
                          <p>
                            {reply.status === "pending"
                              ? history.parser_enabled
                                ? "Awaiting parsing"
                                : "Recorded. A parser endpoint is required."
                              : "Parsing unavailable"}
                          </p>
                        )}
                        {!reply.approved_at &&
                          reply.parsed?.source &&
                          reply.parsed.duration_minutes &&
                          reply.parsed.irrigation_date && (
                            <button
                              className="text-action"
                              disabled={busy}
                              onClick={async () => {
                                if (await submit(`/messages/${reply.id}/approve`)) {
                                  try {
                                    onFieldUpdated(await fetchField(field.id));
                                  } catch {
                                    setStatus(
                                      "Reply approved. Reload the registry to refresh the field history.",
                                    );
                                  }
                                }
                              }}
                            >
                              Approve irrigation record
                            </button>
                          )}
                      </div>
                    ))}
                </article>
              ))
            ) : (
              <p>{history ? "No advisories for this field." : "Loading conversation…"}</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
