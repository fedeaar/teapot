import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + "/home" },
    });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    // auto-confirm is on, sign in immediately
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInErr) {
      setErr(signInErr.message);
      return;
    }
    navigate({ to: "/home" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card-elevated p-6 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold">Create analyst account</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Manage construction sites and worker access tokens.
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
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
        />
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          Have an account?{" "}
          <Link to="/login" className="underline text-foreground">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
