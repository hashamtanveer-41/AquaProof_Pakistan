import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { request, requestImage } from "@/domain/registry";

type Session = { configured: boolean; state: string | null; phone: string | null };
const path = "/assistant/waha";

export function WhatsAppSendingPhone() {
  const [session, setSession] = useState<Session>();
  const [qr, setQr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const autoStarted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    let image: string | undefined;
    autoStarted.current = false;

    async function update() {
      try {
        const result = await request<Session>(
          path + "/session",
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSession(result);
        setError("");
        // No phone is linked yet: start pairing once so the QR appears without an extra click.
        if (
          result.configured &&
          !autoStarted.current &&
          (result.state === "STOPPED" || result.state === "FAILED")
        ) {
          autoStarted.current = true;
          await request(path + "/pair", "POST").catch(() => {});
        }
        const next =
          result.state === "SCAN_QR_CODE"
            ? await requestImage(path + "/qr", controller.signal)
            : null;
        if (controller.signal.aborted) return;
        if (image) URL.revokeObjectURL(image);
        image = next ? URL.createObjectURL(next) : undefined;
        setQr(image);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to check WhatsApp.");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(update, 5000);
      }
    }
    void update();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      if (image) URL.revokeObjectURL(image);
    };
  }, [revision]);

  async function change(action: "pair" | "unlink") {
    if (busy) return;
    if (action === "unlink" && !window.confirm("Unlink the current WhatsApp sending phone?"))
      return;
    setError("");
    setBusy(true);
    setQr(undefined);
    try {
      await request<void>(
        path + "/" + action,
        "POST",
        action === "unlink" ? { confirmation: "UNLINK" } : undefined,
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The WhatsApp action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="WhatsApp sending phone">
      {error && <p role="status">{error}</p>}
      {!session && !error && <p role="status">Checking WhatsApp…</p>}
      {session && !session.configured && (
        <p>Configure the WAHA connection to link a sending phone.</p>
      )}
      {session?.configured && (
        <>
          {session.state === "WORKING" ? (
            <>
              <p>
                {session.phone
                  ? `Linked sending phone +${session.phone}`
                  : "A sending phone is linked."}
              </p>
              <Button onClick={() => void change("unlink")} disabled={busy}>
                Unlink sending phone
              </Button>
            </>
          ) : (
            <>
              {qr ? (
                <>
                  <p>
                    On the new phone, open WhatsApp → Linked devices → Link a device and scan this
                    code.
                  </p>
                  <img src={qr} width={240} height={240} alt="WhatsApp pairing QR code" />
                </>
              ) : (
                <p>
                  {session.state === "STARTING"
                    ? "Starting WAHA…"
                    : "Link a sending phone to use WhatsApp."}
                </p>
              )}
              <Button
                onClick={() => void change("pair")}
                disabled={busy || session.state === "STARTING"}
              >
                {session.state === "SCAN_QR_CODE" ? "Refresh pairing QR" : "Link sending phone"}
              </Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}
