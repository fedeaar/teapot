import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    navigate({ to: "/home" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card-elevated p-6 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold">Analyst sign in</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Workers don't need to sign in — use{" "}
            <Link to="/worker" className="underline">
              the worker page
            </Link>
            .
          </p>
        </div>
        <Input
          type="email"
          placeholder="you@firm.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          minLength={6}
        />
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-background px-2 text-muted-foreground">or</span></div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const { error } = await supabase.auth.signInWithPassword({
              email: "test@test.com",
              password: "test",
            });
            if (error) {
              setErr(error.message);
              setBusy(false);
              return;
            }
            // Find the admin user's first project and navigate to it
            const { data: projects } = await supabase
              .from("projects")
              .select("id")
              .limit(1)
              .single();
            setBusy(false);
            if (projects?.id) {
              navigate({ to: "/project/$projectId", params: { projectId: projects.id } });
            } else {
              navigate({ to: "/projects" });
            }
          }}
        >
          Demo — open as admin
        </Button>
      </form>
    </div>
  );
}
