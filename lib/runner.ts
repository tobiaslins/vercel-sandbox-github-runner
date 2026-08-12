import { Sandbox } from "@vercel/sandbox";

import { positiveIntegerEnv } from "@/lib/env";
import { githubRequest } from "@/lib/github";
import type { WorkflowJobPayload } from "@/lib/webhook";

interface RunnerDownload {
  os: string;
  architecture: string;
  download_url: string;
  filename: string;
}

interface JitConfigResponse {
  runner: { id: number; name: string };
  encoded_jit_config: string;
}

const RUNNER_DIRECTORY = "/vercel/sandbox/actions-runner";
const BOOTSTRAP_LOCK = "/tmp/github-runner-bootstrap.lock";

function sandboxName(jobId: number): string {
  return `github-job-${jobId}`;
}

async function runOrThrow(
  sandbox: Sandbox,
  params: Parameters<Sandbox["runCommand"]>[0] & { cmd: string },
): Promise<void> {
  const result = await sandbox.runCommand(params);
  if (result.exitCode !== 0) {
    throw new Error(`${params.cmd} failed with exit code ${result.exitCode}`);
  }
}

export async function provisionRunner(payload: WorkflowJobPayload): Promise<void> {
  if (!payload.installation) {
    throw new Error("workflow_job webhook did not include an installation id");
  }

  const job = payload.workflow_job;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const name = sandboxName(job.id);
  const timeoutMinutes = positiveIntegerEnv("SANDBOX_TIMEOUT_MINUTES", 45);
  const vcpus = positiveIntegerEnv("SANDBOX_VCPUS", 2);

  const sandbox = await Sandbox.getOrCreate({
    name,
    persistent: false,
    timeout: timeoutMinutes * 60_000,
    resources: { vcpus },
    tags: {
      source: "github-actions",
      job: String(job.id),
    },
  });

  const lock = await sandbox.runCommand("mkdir", [BOOTSTRAP_LOCK]);
  if (lock.exitCode !== 0) {
    console.info("Runner provisioning already started", { jobId: job.id, name });
    return;
  }

  const github = await githubRequest(payload.installation.id);
  let runnerId: number | undefined;

  try {
    const downloads = await github(
      "GET /repos/{owner}/{repo}/actions/runners/downloads",
      { owner, repo },
    );
    const runner = (downloads.data as RunnerDownload[]).find(
      (candidate) => candidate.os === "linux" && candidate.architecture === "x64",
    );
    if (!runner) {
      throw new Error("GitHub did not return a Linux x64 runner download");
    }

    await runOrThrow(sandbox, { cmd: "mkdir", args: ["-p", RUNNER_DIRECTORY] });
    await runOrThrow(sandbox, {
      cmd: "curl",
      args: ["-fsSL", runner.download_url, "-o", `${RUNNER_DIRECTORY}/runner.tar.gz`],
    });
    await runOrThrow(sandbox, {
      cmd: "tar",
      args: ["-xzf", "runner.tar.gz"],
      cwd: RUNNER_DIRECTORY,
    });
    await runOrThrow(sandbox, {
      cmd: "./bin/installdependencies.sh",
      cwd: RUNNER_DIRECTORY,
      sudo: true,
    });

    const jit = await github(
      "POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig",
      {
        owner,
        repo,
        name,
        runner_group_id: positiveIntegerEnv("GITHUB_RUNNER_GROUP_ID", 1),
        labels: job.labels,
        work_folder: "_work",
      },
    );
    const config = jit.data as JitConfigResponse;
    runnerId = config.runner.id;

    await sandbox.runCommand({
      cmd: "./run.sh",
      args: ["--jitconfig", config.encoded_jit_config],
      cwd: RUNNER_DIRECTORY,
      detached: true,
      timeoutMs: timeoutMinutes * 60_000,
      env: {
        ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT: "1",
      },
    });

    console.info("Started GitHub runner", {
      jobId: job.id,
      runnerId,
      runnerName: name,
      sandboxName: sandbox.name,
    });
  } catch (error) {
    if (runnerId) {
      await github("DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}", {
        owner,
        repo,
        runner_id: runnerId,
      }).catch(() => undefined);
    }
    await sandbox.delete().catch(() => undefined);
    throw error;
  }
}

export async function cleanupRunner(payload: WorkflowJobPayload): Promise<void> {
  const name = sandboxName(payload.workflow_job.id);

  try {
    const sandbox = await Sandbox.get({ name, resume: false });
    await sandbox.delete();
    console.info("Deleted GitHub runner sandbox", {
      jobId: payload.workflow_job.id,
      sandboxName: name,
    });
  } catch (error) {
    console.info("Runner sandbox was already absent", {
      jobId: payload.workflow_job.id,
      sandboxName: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
