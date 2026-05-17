import { createFileRoute, Link } from "@tanstack/react-router";
import { HardHat, Briefcase, Map as MapIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TeaPot — Trench documentation" },
      { name: "description", content: "AI-checked trench compliance for fiber sites." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border">
        <h1 className="text-lg font-bold tracking-tight">TeaPot</h1>
        <p className="text-xs text-muted-foreground">
          AI-verified trench documentation for fiber construction
        </p>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="grid sm:grid-cols-2 gap-4 w-full max-w-2xl">
          <Link to="/worker" className="card-elevated p-6 hover:bg-surface transition group">
            <HardHat className="w-8 h-8 text-primary mb-3" />
            <h2 className="font-semibold text-lg">I'm a worker</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Enter the access code from your analyst to open the site map and start documenting
              trenches.
            </p>
            <span className="inline-block mt-4 text-xs text-primary group-hover:underline">
              Enter access code →
            </span>
          </Link>

          <Link to="/login" className="card-elevated p-6 hover:bg-surface transition group">
            <Briefcase className="w-8 h-8 text-primary mb-3" />
            <h2 className="font-semibold text-lg">I'm an analyst</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Manage construction sites, generate worker access tokens, and review compliance
              results.
            </p>
            <span className="inline-block mt-4 text-xs text-primary group-hover:underline">
              Sign in →
            </span>
          </Link>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Demo site available for preview</span>
        <Link
          to="/dashboard"
          search={{ fcp: undefined, trench: undefined, waypoint: undefined }}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <MapIcon className="w-3.5 h-3.5" /> Open dashboard demo
        </Link>
      </footer>
    </div>
  );
}
