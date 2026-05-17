import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listProjects, createProject } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, FolderOpen, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const list = useServerFn(listProjects);
  const create = useServerFn(createProject);

  const [projects, setProjects] = useState<
    { id: string; name: string; description: string | null; created_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await list();
      setProjects(res.projects);
    } catch (e) {
      console.error("Failed to load projects", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await create({ data: { name: name.trim(), description: description.trim() || null } });
      setName("");
      setDescription("");
      setShowForm(false);
      await load();
    } catch (err) {
      console.error("Failed to create project", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/home" className="p-1.5 rounded-md hover:bg-surface">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <FolderOpen className="w-4 h-4 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">Projects</h1>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="w-4 h-4 mr-1" /> New Project
        </Button>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        {showForm && (
          <form onSubmit={handleCreate} className="card-elevated p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My fiber project"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" type="submit" disabled={creating || !name.trim()}>
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" /> Creating...
                  </>
                ) : (
                  "Create"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : projects.length === 0 ? (
          <div className="card-elevated p-8 text-center text-muted-foreground">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {projects.map((p) => (
              <Link
                key={p.id}
                to="/project/$projectId"
                params={{ projectId: p.id }}
                className="card-elevated p-5 hover:bg-surface transition group flex flex-col"
              >
                <h3 className="font-semibold text-base">{p.name}</h3>
                {p.description && (
                  <p className="text-xs text-muted-foreground mt-1 flex-1 line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-primary group-hover:underline">Open &rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
