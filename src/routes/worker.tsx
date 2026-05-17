import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HardHat, Loader2 } from "lucide-react";
import { saveWorkerSession } from "@/lib/worker-session";

export const Route = createFileRoute("/worker")({
  component: WorkerEntry,
});

function WorkerEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const cleaned = code.trim().toUpperCase();

    // Dev shortcut: "0000" unlocks the demo worker dashboard.
    if (cleaned === "0000") {
      const inAWeek = new Date();
      inAWeek.setDate(inAWeek.getDate() + 7);
      saveWorkerSession({
        siteId: "00000000-0000-0000-0000-000000000000",
        siteName: "Demo site",
        code: cleaned,
        expiresAt: inAWeek.toISOString(),
      });
      setBusy(false);
      navigate({ to: "/worker/site" });
      return;
    }

    const { data, error } = await supabase.rpc("redeem_site_token", { _code: cleaned });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      setErr("Invalid or expired code.");
      return;
    }
    saveWorkerSession({
      siteId: row.site_id,
      siteName: row.site_name,
      code: cleaned,
      expiresAt: row.expires_at,
    });
    navigate({ to: "/worker/site" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card-elevated p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <HardHat className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold">Worker access</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter the access code your analyst shared with you.
        </p>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-2345 or 0000"
          required
          maxLength={9}
          autoFocus
          className="font-mono text-center text-lg tracking-widest"
        />
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unlock site"}
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          Are you an analyst?{" "}
          <Link to="/login" className="underline text-foreground">
            Sign in here
          </Link>
        </p>
      </form>
    </div>
  );
}
