# Vercel Sandbox GitHub Runner

A deliberately small proof of concept that creates one ephemeral GitHub Actions
runner in Vercel Sandbox for every matching queued workflow job.

## Architecture

```text
GitHub App -> workflow_job webhook -> Vercel Function -> Vercel Sandbox
```

There is no queue or database. GitHub webhook deliveries are acknowledged
immediately and provisioning continues with Next.js `after()`. A deterministic
sandbox name and a filesystem lock make duplicate queued deliveries harmless.
Each sandbox also has a hard timeout as fallback cleanup.

## GitHub App

Create a GitHub App with:

- Repository permissions:
  - Actions: Read-only
  - Administration: Read and write
- Subscribe to events: Workflow job
- Webhook URL: `https://YOUR_PROJECT.vercel.app/api/github/webhook`
- Install it only on this repository.

Copy the App ID, webhook secret, and generated private key into the Vercel
project environment variables shown in `.env.example`.

## Deploy

```bash
pnpm install
vercel link
vercel env add GITHUB_APP_ID production
vercel env add GITHUB_APP_PRIVATE_KEY production
vercel env add GITHUB_WEBHOOK_SECRET production
vercel deploy --prod
```

Vercel supplies Sandbox authentication automatically through project OIDC.

## Test

Open Actions in GitHub and manually run `Sandbox runner smoke test`. The job
queues with the `vercel-sandbox` label, the webhook creates a named sandbox,
and the JIT runner accepts one job. The completed webhook deletes the sandbox.

## Intentional limitations

- No durable retry if background provisioning fails after the webhook returns.
- No runner diagnostic log export.
- No Docker daemon in the runner yet.
- Default outbound network access is unrestricted.
- The GitHub runner binary and its dependencies are downloaded for every job.

Those are acceptable for the first smoke test and should be addressed before
using this for important CI workloads.
