import { createConnectWebhookVerifier } from "@vercel/connect/chat";

export interface WorkflowJobPayload {
  action: "queued" | "in_progress" | "completed";
  installation?: { id: number };
  repository: {
    name: string;
    owner: { login: string };
  };
  workflow_job: {
    id: number;
    labels: string[];
    runner_name: string | null;
  };
}

export function isWorkflowJobPayload(
  value: unknown,
): value is WorkflowJobPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<WorkflowJobPayload>;

  return (
    ["queued", "in_progress", "completed"].includes(payload.action ?? "") &&
    typeof payload.repository?.name === "string" &&
    typeof payload.repository.owner?.login === "string" &&
    typeof payload.workflow_job?.id === "number" &&
    Array.isArray(payload.workflow_job.labels) &&
    payload.workflow_job.labels.every((label) => typeof label === "string")
  );
}

const verifyConnectWebhook = createConnectWebhookVerifier();

export async function verifyWebhook(
  request: Request,
  body: string,
): Promise<boolean> {
  try {
    await verifyConnectWebhook(request, body);
    return true;
  } catch {
    return false;
  }
}
