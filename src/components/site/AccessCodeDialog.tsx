import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Copy, Check, Loader2 } from "lucide-react";
import { generateToken, listSites } from "@/lib/sites.functions";

type Site = { id: string; name: string };

function defaultExpiry() { 
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function AccessCodeDialog({ trigger }: { trigger: React.ReactNode }) {
  const fetchSites = useServerFn(listSites);
  const generate = useServerFn(generateToken);

  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [expiry, setExpiry] = useState(defaultExpiry());
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCode(null);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setAuthed(false);
        return;
      }
      setAuthed(true);
      try {
        const r = await fetchSites();
        const list = (r.sites as Site[]) ?? [];
        setSites(list);
        if (list.length && !siteId) setSiteId(list[0].id);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, [open, fetchSites, siteId]);

  async function onGenerate() {
    if (!siteId) return;
    setBusy(true);
    setErr(null);
    try {
      const exp = new Date(expiry + "T23:59:59");
      const r: any = await generate({ data: { siteId, expiresAt: exp.toISOString() } });
      setCode(r?.token?.code ?? r?.code ?? null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!code) return;
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Generate worker access code
          </DialogTitle>
          <DialogDescription>
            Workers enter this code on the worker page to unlock the site map and start taking photos.
          </DialogDescription>
        </DialogHeader>

        {err && <p className="text-sm text-danger">{err}</p>}

        {authed === false ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in as an analyst to generate worker access codes.
            </p>
            <Link to="/login" className="inline-block">
              <Button size="sm">Sign in</Button>
            </Link>
          </div>
        ) : authed === null ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sites yet. Create one from your Sites page first.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Site</label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Expires on</label>
              <Input
                type="date"
                value={expiry}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </div>

            {code ? (
              <div className="card-elevated p-3 flex items-center justify-between gap-2">
                <span className="font-mono text-lg tracking-widest">{code}</span>
                <Button size="sm" variant="outline" onClick={copy}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            ) : null}

            <Button onClick={onGenerate} disabled={busy || !siteId} className="w-full">
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : code ? (
                "Generate another"
              ) : (
                "Generate code"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
