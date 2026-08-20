export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", margin: "4rem auto", maxWidth: 720 }}>
      <h1>Vercel Sandbox GitHub Runner</h1>
      <p>
        This deployment creates an isolated, ephemeral Vercel Sandbox runner
        for matching GitHub Actions jobs.
      </p>
      <p>
        Configure one organization-owned GitHub App webhook as{" "}
        <code>{"<this deployment>/api/github/webhook"}</code>, then install the
        App on every repository that should use the runner.
      </p>
      <pre>
        <code>{"runs-on: vercel-sandbox"}</code>
      </pre>
      <p>
        Each webhook is handled directly by this customer-owned deployment. No
        shared control plane or queue receives workflow data.
      </p>
    </main>
  );
}
