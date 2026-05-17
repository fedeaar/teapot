import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FolderPlus, LogOut, Briefcase } from "lucide-react";

export const Route = createFileRoute("/_authenticated/home")({
  component: AnalystHome,
});

function AnalystHome() {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">Analyst workspace</h1>
        </div>
        <Button size="sm" variant="ghost" onClick={signOut}>
          <LogOut className="w-4 h-4 mr-1" /> Sign out
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4">
          <div className="text-center mb-2">
            <h2 className="text-xl font-bold">What do you want to do?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Create a new project or open an existing one.
            </p>
          </div>

          <div className="grid sm:grid-cols-1 gap-4">
            <Link
              to="/projects"
              className="card-elevated p-6 hover:bg-surface transition group flex flex-col"
            >
              <FolderPlus className="w-8 h-8 text-primary mb-3" />
              <h3 className="font-semibold text-lg">My projects</h3>
              <p className="text-xs text-muted-foreground mt-1 flex-1">
                Create a project, upload GeoJSON geometry, and import photos for compliance
                analysis.
              </p>
              <span className="inline-block mt-4 text-xs text-primary group-hover:underline">
                Open projects →
              </span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
