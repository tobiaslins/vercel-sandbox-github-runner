# Vercel Sandbox GitHub Runner

Run GitHub Actions jobs on short-lived, customer-owned Vercel Sandboxes. One
Vercel project can serve every selected repository in a GitHub organization.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftobiaslins%2Fvercel-sandbox-github-runner&project-name=vercel-sandbox-github-runner&repository-name=vercel-sandbox-github-runner&connect=%5B%7B%22type%22%3A%22github%22%2C%22env%22%3A%22GITHUB_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22events%22%3A%5B%22workflow_job%22%5D%2C%22permissions%22%3A%7B%22actions%22%3A%22read%22%2C%22administration%22%3A%22write%22%7D%2C%22triggerPath%22%3A%22%2Fapi%2Fgithub%2Fwebhook%22%7D%5D)

## How it works

```text
GitHub organization
  workflow_job event
    Vercel Connect GitHub connector
      Customer-owned Vercel Function
        Customer-owned Vercel Sandbox
          Repository-scoped ephemeral runner
```

Each queued job starts an ephemeral GitHub runner in a Sandbox owned by your
Vercel account. The runner is registered only with the repository that queued
the job and uses short-lived credentials.

There is no queue, database, shared runner service, or long-lived GitHub
credential. Sandboxes are not deleted after a job, so they remain available for
inspection until their timeout expires.

## Setup

### 1. Deploy the project

Click **Deploy with Vercel** above and follow the prompts. The deploy flow
creates the Vercel project and connects it to GitHub.

### 2. Choose repositories

When GitHub configuration opens:

- choose the GitHub organization and repositories that may use the runner;
- review the preselected **Actions: Read-only** and **Administration: Read and
  write** permissions;
- approve the installation.

The Deploy Button also preselects the `workflow_job` event. Customers approve
the requested access once during installation; there is no later permission
update step.

### 3. Use the runner

Use a run-scoped label in any selected repository:

```yaml
jobs:
  test:
    runs-on: vercel-sandbox-${{ github.run_id }}-${{ github.run_attempt }}
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```

That is it. The next queued job with this label starts its own Vercel Sandbox.
The run ID and attempt keep a new Sandbox from consuming an older queued job.

## Manual setup

If the project was created without the Deploy Button, run these commands from a
checkout linked to the Vercel project:

```bash
vercel connect create github \
  --name vercel-sandbox-github-runner \
  --triggers

vercel connect attach github/vercel-sandbox-github-runner \
  --environment production \
  --triggers \
  --trigger-path /api/github/webhook
```

The first command opens GitHub configuration. Choose the repositories and
permissions listed above, and select `workflow_job`.

If the connector has a different UID, set `GITHUB_CONNECTOR` to that UID and
redeploy. No GitHub App ID, private key, webhook secret, or Vercel Integration is
required.

## Faster startup with a snapshot

Without a snapshot, Docker and the current GitHub runner are installed during
each Sandbox boot. Create a reusable snapshot once from a Vercel-authenticated
shell:

```bash
vercel env run -- pnpm snapshot:create
```

Set the printed ID as `SANDBOX_SNAPSHOT_ID` in the Vercel project and redeploy.
Rebuild the snapshot when updating the pinned runner version or base
dependencies.

## Configuration

All variables are optional when the connector uses the default name:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_CONNECTOR` | `github/vercel-sandbox-github-runner` | Vercel Connect connector UID |
| `GITHUB_RUNNER_LABEL` | `vercel-sandbox` | Required workflow runner label prefix |
| `SANDBOX_SNAPSHOT_ID` | empty | Prebuilt runner filesystem snapshot |
| `SANDBOX_TIMEOUT_MINUTES` | `45` | Sandbox hard timeout |
| `SANDBOX_VCPUS` | `2` | Sandbox virtual CPU count |

## Behavior and security

- Every matching queued job gets a repository-scoped, `--ephemeral` runner.
- Vercel Connect verifies webhook requests before forwarding them. Direct
  webhook POSTs from GitHub are rejected.
- GitHub installation and runner registration tokens are short-lived and never
  stored by this application.
- Docker starts before the runner, so container actions and service containers
  work. A workflow with Docker access should be considered root inside its
  isolated Sandbox.
- The Sandbox remains after the job for debugging and stops only at
  `SANDBOX_TIMEOUT_MINUTES`.
- Repository access is controlled by the GitHub installation behind the
  connector. Add more repositories there without deploying another project.

## Current limitations

- Vercel Connect is currently beta.
- One deployment expects one GitHub organization installation. Multiple
  organizations need separate connectors or explicit installation routing.
- Provisioning has no durable retry after the webhook is acknowledged.
- There is no concurrency policy beyond the customer's Vercel account limits.
- Runner diagnostics are not exported to durable storage.
