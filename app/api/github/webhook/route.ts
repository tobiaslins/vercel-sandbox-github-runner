import { after } from "next/server";

import { requiredEnv } from "@/lib/env";
import { provisionRunner } from "@/lib/runner";
import {
  type WorkflowJobPayload,
  verifyWebhookSignature,
} from "@/lib/webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const valid = verifyWebhookSignature(
    body,
    request.headers.get("x-hub-signature-256"),
    requiredEnv("GITHUB_WEBHOOK_SECRET"),
  );

  if (!valid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (request.headers.get("x-github-event") !== "workflow_job") {
    return Response.json({ ignored: true });
  }

  const payload = JSON.parse(body) as WorkflowJobPayload;
  const runnerLabel = process.env.GITHUB_RUNNER_LABEL ?? "vercel-sandbox";
  if (!payload.workflow_job.labels.includes(runnerLabel)) {
    return Response.json({ ignored: true });
  }

  if (payload.action === "queued") {
    after(async () => {
      await provisionRunner(payload).catch((error) => {
        console.error("Runner provisioning failed", {
          jobId: payload.workflow_job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  return Response.json({ accepted: true }, { status: 202 });
}
