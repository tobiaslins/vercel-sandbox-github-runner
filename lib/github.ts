import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";

import { requiredEnv } from "@/lib/env";

export async function githubRequest(installationId: number) {
  const auth = createAppAuth({
    appId: requiredEnv("GITHUB_APP_ID"),
    privateKey: requiredEnv("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
    installationId,
  });

  const { token } = await auth({ type: "installation" });

  return request.defaults({
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2026-03-10",
      "user-agent": "vercel-sandbox-github-runner",
    },
  });
}
