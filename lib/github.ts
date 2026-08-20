import { request } from "@octokit/request";
import { getToken } from "@vercel/connect";

const DEFAULT_CONNECTOR = "github/vercel-sandbox-github-runner";

export async function githubRequest() {
  const token = await getToken(
    process.env.GITHUB_CONNECTOR ?? DEFAULT_CONNECTOR,
    {
      subject: { type: "app" },
    },
  );

  return request.defaults({
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2026-03-10",
      "user-agent": "vercel-sandbox-github-runner",
    },
  });
}
