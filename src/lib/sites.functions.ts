import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sites")
      .select("id,name")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { sites: data ?? [] };
  });

export const generateToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ siteId: z.string().uuid(), expiresAt: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((b) => b.toString(36).toUpperCase().padStart(2, "0"))
      .join("")
      .slice(0, 6);

    const { data: token, error } = await context.supabase
      .from("site_tokens")
      .insert({
        site_id: data.siteId,
        code,
        expires_at: data.expiresAt,
        created_by: context.userId,
      })
      .select("code")
      .single();
    if (error) throw new Error(error.message);
    return { token };
  });
