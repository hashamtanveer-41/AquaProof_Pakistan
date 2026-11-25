import { useEffect, useState } from "react";
import { Button, Card, Chip } from "@/components/ui";
import { request } from "@/domain/registry";

type Service = {
  provider: string;
  endpoint: string;
  status: "operational" | "degraded" | "unavailable" | "misconfigured";
  checked_at: string;
  latency_ms: number;
  http_status?: number;
  detail?: string;
  quota_remaining_usd?: number | null;
  coverage?: Record<string, { ok: boolean; detail?: string }>;
};

export function ServiceHealth() {
  const [services, setServices] = useState<Service[]>();
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request<{ services: Service[]; enabled: boolean }>(
      "/admin/services",
      "GET",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setServices(data.services);
          setEnabled(data.enabled);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Checks unavailable.");
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <Card
      title="External service status"
      subtitle="Automated checks run twice an hour."
      action={<Button onClick={() => setRevision((value) => value + 1)}>Refresh status</Button>}
    >
      {error && <p role="alert">{error}</p>}
      {!error && !services?.length && (
        <p role="status">
          {enabled ? "Waiting for the first service checks." : "Scheduled checks are disabled."}
        </p>
      )}
      {services && services.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Observed result</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.provider + service.endpoint}>
                  <td>
                    <strong>{service.provider}</strong>
                    <br />
                    <small style={{ overflowWrap: "anywhere" }}>{service.endpoint}</small>
                  </td>
                  <td>
                    <Chip tone={service.status === "operational" ? "green" : "amber"} dot>
                      {service.status}
                    </Chip>
                  </td>
                  <td>
                    {[
                      service.http_status && `HTTP ${service.http_status}`,
                      service.detail,
                      `${service.latency_ms} ms`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {service.quota_remaining_usd != null && (
                      <p>Credit limit remaining {service.quota_remaining_usd} USD</p>
                    )}
                    {service.coverage && (
                      <details>
                        <summary>Pakistan coverage</summary>
                        <ul>
                          {Object.entries(service.coverage).map(([site, sample]) => (
                            <li key={site}>
                              {site} ·{" "}
                              {sample.ok ? "Passed" : (sample.detail ?? "Required data missing")}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>
                    {new Date(service.checked_at).toLocaleString("en-PK", {
                      timeZone: "Asia/Karachi",
                    })}{" "}
                    PKT
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
