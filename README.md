# Vercel Sandbox GitHub Runner

Run GitHub Actions jobs on short-lived, customer-owned Vercel Sandboxes. One
Vercel project can serve every selected repository in a GitHub organization.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftobiaslins%2Fvercel-sandbox-github-runner&project-name=vercel-sandbox-github-runner&repository-name=vercel-sandbox-github-runner)

## Architecture

```text
GitHub organization
  workflow_job event
    Vercel Connect GitHub connector
      Customer-owned Vercel Function
        Customer-owned Vercel Sandbox
          Repository-scoped ephemeral runner
```

There is no queue, database, long-lived GitHub credential, or shared runner
control plane. Vercel Connect manages the GitHub App, verifies GitHub's webhook,
and forwards it with Vercel OIDC to the customer's deployment. The function
requests a short-lived installation token and registers a runner only with the
repository that queued the job.

Duplicate webhook deliveries are handled by a deterministic sandbox name and a
filesystem lock. A sandbox is not deleted after its job completes; it remains
available for inspection until its hard timeout expires.

## Setup

### 1. Deploy the project

Use the Deploy Button above. The resulting Vercel project owns all Functions,
Sandboxes, usage, and logs.

Make sure OIDC Federation is enabled for the project. Vercel deployments use it
to authenticate both Vercel Connect and Sandbox without stored credentials.

### 2. Create the GitHub connector

In Vercel Connect, create a managed GitHub connector named
`vercel-sandbox-github-runner` with webhook triggers enabled. During its GitHub
configuration:

- grant repository **Actions: Read-only**;
- grant repository **Administration: Read and write**;
- manually add the `workflow_job` trigger event;
- install it on the GitHub organization and choose all or selected repositories.

Then attach the connector to the deployed project for **Production** and set its
trigger destination to:

```text
/api/github/webhook
```

The equivalent CLI flow, run from a checkout linked to the deployed Vercel
project, is:

```bash
vercel connect create github \
  --name vercel-sandbox-github-runner \
  --triggers

vercel connect attach github/vercel-sandbox-github-runner \
  --environment production \
  --triggers \
  --trigger-path /api/github/webhook
```

The create flow opens the managed GitHub connector configuration, where
`workflow_job`, permissions, organization, and repository access are selected.

If the connector has a different UID, set `GITHUB_CONNECTOR` to that UID and
redeploy. No GitHub App ID, private key, webhook secret, or Vercel Integration is
required.

### 3. Target the runner

Use the dedicated label from any repository selected during connector setup:

```yaml
jobs:
  test:
    runs-on: vercel-sandbox
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```

The runner disables GitHub's default `self-hosted`, `Linux`, and `X64` labels so
it cannot accidentally accept an unrelated self-hosted job.

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
| `GITHUB_RUNNER_LABEL` | `vercel-sandbox` | Required workflow runner label |
| `SANDBOX_SNAPSHOT_ID` | empty | Prebuilt runner filesystem snapshot |
| `SANDBOX_TIMEOUT_MINUTES` | `45` | Sandbox hard timeout |
| `SANDBOX_VCPUS` | `2` | Sandbox virtual CPU count |

## Behavior and security

- Every matching queued job gets a repository-scoped, `--ephemeral` runner.
- Connect webhook requests are verified with a short-lived Vercel OIDC token.
  Direct webhook POSTs from GitHub are rejected.
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
