export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", margin: "4rem auto", maxWidth: 720 }}>
      <h1>Vercel Sandbox GitHub Runner</h1>
      <p>
        This deployment creates an isolated, ephemeral Vercel Sandbox runner
        for matching GitHub Actions jobs.
      </p>
      <p>
        Attach a Vercel Connect GitHub connector to this project and forward its
        <code> workflow_job </code> trigger to{" "}
        <code>/api/github/webhook</code>.
      </p>
      <pre>
        <code>{"runs-on: vercel-sandbox"}</code>
      </pre>
      <p>
        Connect verifies GitHub and forwards the event here with Vercel OIDC.
        This customer-owned deployment starts the Sandbox directly; there is no
        queue or shared runner control plane.
      </p>
    </main>
  );
}
