import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id,name,description,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id };
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("id,name,description,created_by,created_at")
      .eq("id", data.projectId)
      .single();
    if (error) throw new Error(error.message);

    const { count: clustersCount } = await context.supabase
      .from("site_clusters")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId);

    const { count: imagesCount } = await context.supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId);

    return { project, stats: { clusters: clustersCount ?? 0, images: imagesCount ?? 0 } };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .delete()
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
