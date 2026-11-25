import { useEffect, useState } from "react";
import { Button, Card, Chip } from "@/components/ui";
import { request } from "@/domain/registry";

type Lifecycle =
  | { status: "planting_date_required" | "calendar_unavailable" }
  | {
      status: "modeled";
      crop: string;
      variety: string | null;
      current_stage: string;
      modeled_maturity: string;
      stages: { name: string; starts_on: string; ends_before: string }[];
      provenance: string;
      regional_reference: { label: string; source: string; guidance: string } | null;
    };

export function CropLifecycle({ path }: { path: string }) {
  const [answer, setAnswer] = useState<Lifecycle>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setAnswer(undefined);
    request<Lifecycle>(`${path}/crop-lifecycle`, "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setAnswer(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Crop lifecycle unavailable.");
      });
    return () => controller.abort();
  }, [path, retry]);

  return (
    <Card title="Crop lifecycle" subtitle="Calendar estimate based on the recorded planting date.">
      {error ? (
        <div role="alert">
          {error} <Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>
        </div>
      ) : answer?.status === "modeled" ? (
        <>
          <p>
            {[answer.crop, answer.variety].filter(Boolean).join(" · ")} · {answer.current_stage}
          </p>
          <ol className="crop-lifecycle">
            {answer.stages.map((stage) => (
              <li
                key={stage.name}
                aria-current={stage.name === answer.current_stage ? "step" : undefined}
              >
                <Chip tone={stage.name === answer.current_stage ? "green" : "gray"}>
                  {stage.name}
                </Chip>
                <time dateTime={stage.starts_on}>{stage.starts_on}</time>
              </li>
            ))}
            <li>
              <Chip>Modeled maturity</Chip>
              <time dateTime={answer.modeled_maturity}>{answer.modeled_maturity}</time>
            </li>
          </ol>
          <small>{answer.provenance}</small>
          {answer.regional_reference && (
            <p>
              {answer.regional_reference.guidance}{" "}
              <a href={answer.regional_reference.source} target="_blank" rel="noreferrer">
                {answer.regional_reference.label} reference
              </a>
            </p>
          )}
        </>
      ) : (
        <p role="status">
          {answer?.status === "calendar_unavailable"
            ? "A calendar is unavailable for this crop."
            : answer
              ? "Record planting in Crop Monitoring to estimate the lifecycle."
              : "Loading the crop lifecycle…"}
        </p>
      )}
    </Card>
  );
}
