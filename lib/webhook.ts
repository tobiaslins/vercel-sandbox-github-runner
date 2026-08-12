import { createHmac, timingSafeEqual } from "node:crypto";

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

export function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const supplied = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
