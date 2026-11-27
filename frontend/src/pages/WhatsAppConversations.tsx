import { useEffect, useState } from "react";
import { Button, Card, Chip, PageTitle } from "@/components/ui";
import type { Farmer, Field } from "@/domain/data";
import { request } from "@/domain/registry";

type Conversation = {
  verified_at: string | null;
  next_cursor: string | null;
  messages: {
    id: string;
    direction: "inbound" | "outbound";
    kind: string;
    status: string;
    body: string;
  }[];
};

export default function WhatsAppConversations({
  farmers,
  fields,
  selectedFarmerId,
  openAdvisory,
}: {
  farmers: Farmer[];
  fields: Field[];
  selectedFarmerId: string;
  openAdvisory: (fieldId: string) => void;
}) {
  const [selection, setSelection] = useState("");
  const farmer = farmers.find((item) => item.id === (selection || selectedFarmerId)) ?? farmers[0];
  const field = fields.find((item) => item.farmerId === farmer?.id);
  return (
    <>
      <PageTitle
        eyebrow="FARMER COMMUNICATIONS"
        title="WhatsApp Conversations"
        description="Read farmer replies, officer messages and assistant advisories across fields."
      />
      <Card
        title="Conversation history"
        action={
          field && <Button onClick={() => openAdvisory(field.id)}>Open Advisory Center</Button>
        }
      >
        {farmer ? (
          <>
            <div className="form-grid">
              <label>
                <span id="conversation-farmer-label">Farmer</span>
                <select
                  aria-labelledby="conversation-farmer-label"
                  value={farmer.id}
                  onChange={(event) => setSelection(event.target.value)}
                >
                  {farmers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.village || item.region}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Thread key={farmer.id} farmerId={farmer.id} />
          </>
        ) : (
          <p>Register a farmer to view WhatsApp conversations.</p>
        )}
      </Card>
    </>
  );
}

function Thread({ farmerId }: { farmerId: string }) {
  const [before, setBefore] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function load() {
      const path = "/assistant/conversations/" + encodeURIComponent(farmerId);
      try {
        const data = await request<Conversation>(
          path + (before ? "?before=" + encodeURIComponent(before) : ""),
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setConversation(data);
        setError("");
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Conversation could not be loaded.",
          );
      } finally {
        if (!before && !controller.signal.aborted) timer = window.setTimeout(load, 8000);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [farmerId, before, reload]);

  function changePage(cursor: string | null) {
    setConversation(undefined);
    setError("");
    setBefore(cursor);
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const { status } = await request<{ status: "synchronized" | "local" }>(
        "/assistant/conversations/" + encodeURIComponent(farmerId) + "/refresh",
        "POST",
      );
      setRefreshMessage(
        status === "synchronized" ? "WhatsApp inbox checked." : "Refreshed saved conversation.",
      );
    } catch (failure) {
      setRefreshMessage(failure instanceof Error ? failure.message : "WhatsApp sync failed.");
    } finally {
      setBefore(null);
      setReload((value) => value + 1);
      setRefreshing(false);
    }
  }

  return (
    <>
      {error && <p role="status">{error}</p>}
      {!conversation && !error && <p role="status">Loading conversation…</p>}
      {conversation && (
        <div className="whatsapp-thread">
          <p>
            <Chip tone={conversation.verified_at ? "green" : "neutral"}>
              {conversation.verified_at ? "Verified WhatsApp" : "Farmer verification pending"}
            </Chip>
          </p>
          {!conversation.verified_at && (
            <p>The sending phone pairs in WAHA. The farmer confirms separately by sending YES.</p>
          )}
          {conversation.messages.length ? (
            <ol className="whatsapp-messages">
              {[...conversation.messages].reverse().map((message) => {
                const who =
                  message.direction === "inbound"
                    ? "Farmer"
                    : message.kind === "manual"
                      ? "Officer"
                      : "AquaProof";
                return (
                  <li
                    key={message.id}
                    className={`whatsapp-message ${message.direction}`}
                    aria-label={who}
                  >
                    <p className="live-message" dir="auto">
                      {message.body || (message.kind === "verify" ? "Verification confirmed." : "")}
                    </p>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>No WhatsApp messages for this farmer yet.</p>
          )}
        </div>
      )}
      <div className="whatsapp-thread-actions">
        {before && <Button onClick={() => changePage(null)}>Latest messages</Button>}
        {conversation?.next_cursor && (
          <Button onClick={() => changePage(conversation.next_cursor)}>Older messages</Button>
        )}
        <Button onClick={refresh} disabled={refreshing}>
          {refreshing ? "Checking WhatsApp…" : "Refresh conversation"}
        </Button>
      </div>
      {refreshMessage && <p role="status">{refreshMessage}</p>}
    </>
  );
}
