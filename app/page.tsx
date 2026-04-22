import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-5xl font-mono tracking-tight">mesh</h1>
        <p className="text-muted-foreground text-lg">
          The living layer over your codebase — tickets in, production-ready
          PRs out.
        </p>
        <p className="text-sm text-muted-foreground">
          Scaffold alive. Capabilities arrive phase by phase.
        </p>
      </div>

      <div className="flex gap-3 text-sm flex-wrap justify-center">
        <Link
          href="/connect"
          className="rounded-md border border-accent bg-accent/10 text-accent px-4 py-2 font-mono hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          /connect
        </Link>
        <Link
          href="/repos"
          className="rounded-md border border-border bg-muted px-4 py-2 font-mono hover:border-accent hover:text-accent transition-colors"
        >
          /repos
        </Link>
        <Link
          href="/settings"
          className="rounded-md border border-border bg-muted px-4 py-2 font-mono hover:border-accent hover:text-accent transition-colors"
        >
          /settings
        </Link>
      </div>

      <footer className="text-xs text-muted-foreground font-mono absolute bottom-6">
        v0.0.0 · built on Claude Opus 4.7
      </footer>
    </main>
  );
}
