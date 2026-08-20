import { Sandbox } from "@vercel/sandbox";

const runnerVersion = process.env.GITHUB_RUNNER_VERSION ?? "2.336.0";
const runnerSha256 =
  process.env.GITHUB_RUNNER_SHA256 ??
  "04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d";
const runnerDirectory = "/vercel/sandbox/actions-runner";

const sandbox = await Sandbox.create({
  timeout: 15 * 60_000,
  resources: { vcpus: 2 },
  tags: {
    source: "github-actions",
    purpose: "runner-snapshot",
  },
});

let snapshotCreated = false;

try {
  const install = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      `set -euo pipefail
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl docker.io
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl docker
else
  echo "No supported package manager found" >&2
  exit 1
fi
mkdir -p ${runnerDirectory}
curl -fsSL "https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-linux-x64-${runnerVersion}.tar.gz" -o /tmp/actions-runner.tar.gz
echo "${runnerSha256}  /tmp/actions-runner.tar.gz" | sha256sum -c -
tar -xzf /tmp/actions-runner.tar.gz -C ${runnerDirectory}
${runnerDirectory}/bin/installdependencies.sh
chown -R vercel-sandbox:vercel-sandbox ${runnerDirectory}`,
    ],
    sudo: true,
  });

  if (install.exitCode !== 0) {
    throw new Error(`Snapshot setup failed with exit code ${install.exitCode}`);
  }

  const snapshot = await sandbox.snapshot({ expiration: 0 });
  snapshotCreated = true;
  console.log(snapshot.snapshotId);
} finally {
  if (!snapshotCreated) {
    await sandbox.delete().catch(() => undefined);
  }
}
