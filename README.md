# Vercel Sandbox GitHub Runner

One Vercel project can provide on-demand GitHub Actions runners for every
repository selected during a GitHub App installation.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftobiaslins%2Fvercel-sandbox-github-runner&project-name=vercel-sandbox-github-runner&repository-name=vercel-sandbox-github-runner)

## Architecture

```text
Customer GitHub organization
  GitHub App installation (selected repositories)
    workflow_job webhook
      One customer-owned Vercel project
        One Vercel Sandbox per queued job
          One repository-scoped ephemeral runner
```

There is no queue, shared control plane, or database. The webhook payload
contains both the App installation ID and repository, so the deployment mints a
short-lived installation token and registers the runner only with the repository
that queued the job.

Duplicate webhook deliveries are handled by a deterministic sandbox name and a
filesystem lock. A sandbox is not deleted when its job completes; it remains
available for inspection until its hard timeout expires.

## Customer setup

### 1. Deploy one project

Use the Deploy Button above. The repository must be public before the button can
be offered to customers who do not already have access to it.

### 2. Create one GitHub App for the organization

Create a private GitHub App owned by the customer organization with:

- Repository permissions:
  - Actions: Read-only
  - Administration: Read and write
- Subscribe to events: `Workflow job`
- Webhook URL: `https://YOUR_PROJECT.vercel.app/api/github/webhook`
- Webhook active: enabled

Install the App for **all repositories** or a selected set. Adding another
repository later only requires changing the App installation's repository
access; no second Vercel deployment is needed.

### 3. Configure the Vercel project

Add the App ID, webhook secret, and generated private key as production
environment variables:

```bash
vercel env add GITHUB_APP_ID production
vercel env add GITHUB_APP_PRIVATE_KEY production
vercel env add GITHUB_WEBHOOK_SECRET production
vercel deploy --prod
```

Vercel supplies Sandbox authentication through project OIDC. The remaining
optional settings are documented in `.env.example`.

### 4. Target the runner from any installed repository

```yaml
jobs:
  test:
    runs-on: vercel-sandbox
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```

The runner is registered with only the dedicated `vercel-sandbox` label. Default
labels such as `self-hosted`, `Linux`, and `X64` are disabled so the temporary
runner cannot accidentally accept an unrelated self-hosted job.

## Faster startup with a snapshot

Without a snapshot, Docker and the current GitHub runner are installed during
each sandbox boot. Create a reusable snapshot once from a Vercel-authenticated
shell:

```bash
vercel env run -- pnpm snapshot:create
```

Set the printed ID as `SANDBOX_SNAPSHOT_ID` in the Vercel project and redeploy.
The worker will boot future sandboxes from that filesystem image. Rebuild the
snapshot when updating the pinned runner version or base dependencies.

## Behavior and security

- Every job gets a repository-scoped, `--ephemeral` runner.
- Docker is started before the runner, so container actions and service
  containers work. A workflow with Docker access should be considered root on
  that job's isolated sandbox.
- The sandbox keeps running after the job for debugging and is stopped only by
  `SANDBOX_TIMEOUT_MINUTES` (45 minutes by default).
- App installation tokens and runner registration tokens are short-lived and
  are never stored by this application.
- The App can only serve repositories granted to its installation. GitHub will
  reject token or runner operations for any other repository.

## Distribution path

The Deploy Button already creates the customer-owned compute plane. A fully
automated onboarding product can add a small Vercel Integration and use GitHub's
App Manifest flow:

1. The Vercel Integration deploys this repository into the customer's team.
2. The manifest creates a private GitHub App with this deployment's webhook URL.
3. The integration stores the returned App ID, PEM, and webhook secret as
   project environment variables and redeploys.
4. The customer installs the App on any number of repositories.

That setup layer never needs to proxy workflow webhooks or run customer jobs.
After onboarding, GitHub talks directly to the customer's Vercel deployment.

## Current limitations

- Provisioning has no durable retry after the webhook has been acknowledged.
- There is no autoscaling quota or concurrency policy beyond Vercel account
  limits.
- Runner diagnostic logs are not exported to durable storage.
- The one-click GitHub App manifest and Vercel Integration onboarding flow is
  not implemented yet.
