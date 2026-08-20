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

interface RegistrationTokenResponse {
  token: string;
}

interface RunnerListResponse {
  runners: Array<{ id: number; name: string }>;
}

const RUNNER_DIRECTORY = "/vercel/sandbox/actions-runner";
const BOOTSTRAP_LOCK = "/tmp/github-runner-bootstrap.lock";
const DOCKER_HOST = "unix:///var/run/docker.sock";

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

async function installDocker(sandbox: Sandbox): Promise<void> {
  const installed = await sandbox.runCommand("docker", ["--version"]);
  if (installed.exitCode === 0) return;

  await runOrThrow(sandbox, {
    cmd: "bash",
    args: [
      "-lc",
      [
        "if command -v apt-get >/dev/null 2>&1; then",
        "  apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io;",
        "elif command -v dnf >/dev/null 2>&1; then",
        "  dnf install -y docker;",
        "else",
        "  echo 'No supported package manager found' >&2; exit 1;",
        "fi",
      ].join("\n"),
    ],
    sudo: true,
  });
}

async function installRunner(
  sandbox: Sandbox,
  downloadUrl: string,
): Promise<void> {
  const installed = await sandbox.runCommand("test", [
    "-x",
    `${RUNNER_DIRECTORY}/run.sh`,
  ]);
  if (installed.exitCode === 0) return;

  await runOrThrow(sandbox, { cmd: "mkdir", args: ["-p", RUNNER_DIRECTORY] });
  await runOrThrow(sandbox, {
    cmd: "curl",
    args: ["-fsSL", downloadUrl, "-o", `${RUNNER_DIRECTORY}/runner.tar.gz`],
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
}

async function startDocker(sandbox: Sandbox): Promise<void> {
  const running = await sandbox.runCommand("docker", ["info"]);
  if (running.exitCode !== 0) {
    await sandbox.runCommand({
      cmd: "dockerd",
      args: ["--host", DOCKER_HOST],
      detached: true,
      sudo: true,
    });
  }

  await runOrThrow(sandbox, {
    cmd: "bash",
    args: [
      "-lc",
      "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && chmod 0666 /var/run/docker.sock && exit 0; sleep 1; done; exit 1",
    ],
    sudo: true,
  });
}

async function removeRunnerByName(
  github: Awaited<ReturnType<typeof githubRequest>>,
  owner: string,
  repo: string,
  name: string,
): Promise<void> {
  const response = await github(
    "GET /repos/{owner}/{repo}/actions/runners",
    { owner, repo, name, per_page: 100 },
  );
  const runners = (response.data as RunnerListResponse).runners.filter(
    (runner) => runner.name === name,
  );

  await Promise.all(
    runners.map((runner) =>
      github("DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}", {
        owner,
        repo,
        runner_id: runner.id,
      }),
    ),
  );
}

export async function provisionRunner(payload: WorkflowJobPayload): Promise<void> {
  if (!payload.installation) {
    throw new Error("workflow_job webhook did not include an installation id");
  }

  const job = payload.workflow_job;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const name = sandboxName(job.id);
  const runnerLabel = process.env.GITHUB_RUNNER_LABEL ?? "vercel-sandbox";
  const timeoutMinutes = positiveIntegerEnv("SANDBOX_TIMEOUT_MINUTES", 45);
  const vcpus = positiveIntegerEnv("SANDBOX_VCPUS", 2);
  const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;

  const sandboxOptions = {
    name,
    persistent: false,
    timeout: timeoutMinutes * 60_000,
    resources: { vcpus },
    tags: {
      source: "github-actions",
      job: String(job.id),
      repository: `${owner}/${repo}`.slice(0, 64),
    },
  };
  const sandbox = snapshotId
    ? await Sandbox.getOrCreate({
        ...sandboxOptions,
        source: { type: "snapshot", snapshotId },
      })
    : await Sandbox.getOrCreate(sandboxOptions);

  const lock = await sandbox.runCommand("mkdir", [BOOTSTRAP_LOCK]);
  if (lock.exitCode !== 0) {
    console.info("Runner provisioning already started", { jobId: job.id, name });
    return;
  }

  const github = await githubRequest(payload.installation.id);

  try {
    await installDocker(sandbox);

    const runnerInstalled = await sandbox.runCommand("test", [
      "-x",
      `${RUNNER_DIRECTORY}/run.sh`,
    ]);
    if (runnerInstalled.exitCode !== 0) {
      const downloads = await github(
        "GET /repos/{owner}/{repo}/actions/runners/downloads",
        { owner, repo },
      );
      const runner = (downloads.data as RunnerDownload[]).find(
        (candidate) =>
          candidate.os === "linux" && candidate.architecture === "x64",
      );
      if (!runner) {
        throw new Error("GitHub did not return a Linux x64 runner download");
      }
      await installRunner(sandbox, runner.download_url);
    }

    await startDocker(sandbox);

    const registration = await github(
      "POST /repos/{owner}/{repo}/actions/runners/registration-token",
      { owner, repo },
    );
    const { token } = registration.data as RegistrationTokenResponse;

    await runOrThrow(sandbox, {
      cmd: "./config.sh",
      args: [
        "--unattended",
        "--ephemeral",
        "--disableupdate",
        "--no-default-labels",
        "--url",
        `https://github.com/${owner}/${repo}`,
        "--token",
        token,
        "--name",
        name,
        "--labels",
        runnerLabel,
        "--work",
        "_work",
      ],
      cwd: RUNNER_DIRECTORY,
    });

    await sandbox.runCommand({
      cmd: "./run.sh",
      cwd: RUNNER_DIRECTORY,
      detached: true,
      timeoutMs: timeoutMinutes * 60_000,
      env: {
        ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT: "1",
        DOCKER_HOST,
      },
    });

    console.info("Started GitHub runner", {
      installationId: payload.installation.id,
      repository: `${owner}/${repo}`,
      jobId: job.id,
      runnerName: name,
      sandboxName: sandbox.name,
    });
  } catch (error) {
    await removeRunnerByName(github, owner, repo, name).catch(() => undefined);
    await sandbox.delete().catch(() => undefined);
    throw error;
  }
}
