import { after } from "next/server";

import { provisionRunner } from "@/lib/runner";
import { isWorkflowJobPayload, verifyWebhook } from "@/lib/webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

function provisioningErrorDetails(error: unknown): {
  message: string;
  status?: number;
  code?: string;
  apiMessage?: string;
} {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const apiError = error as Error & {
    response?: { status?: number };
    json?: {
      code?: unknown;
      message?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
  };
  const code = apiError.json?.error?.code ?? apiError.json?.code;
  const apiMessage = apiError.json?.error?.message ?? apiError.json?.message;

  return {
    message: error.message,
    ...(typeof apiError.response?.status === "number"
      ? { status: apiError.response.status }
      : {}),
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof apiMessage === "string" ? { apiMessage } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const valid = await verifyWebhook(request, body);

  if (!valid) {
    return Response.json({ error: "Invalid Vercel OIDC token" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  if (event && event !== "workflow_job") {
    return Response.json({ ignored: true });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isWorkflowJobPayload(payload)) {
    return Response.json({ error: "Invalid workflow_job payload" }, { status: 400 });
  }
  const runnerLabel = process.env.GITHUB_RUNNER_LABEL ?? "vercel-sandbox";
  const matchesRunner = payload.workflow_job.labels.some(
    (label) => label === runnerLabel || label.startsWith(`${runnerLabel}-`),
  );
  if (!matchesRunner) {
    return Response.json({ ignored: true });
  }

  if (payload.action === "queued") {
    after(async () => {
      await provisionRunner(payload).catch((error) => {
        console.error("Runner provisioning failed", {
          jobId: payload.workflow_job.id,
          error: provisioningErrorDetails(error),
        });
      });
    });
  }

  return Response.json({ accepted: true }, { status: 202 });
}
