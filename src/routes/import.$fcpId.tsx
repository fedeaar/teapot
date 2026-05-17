import { createFileRoute } from "@tanstack/react-router";
import { PhotoImporter } from "@/components/site/PhotoImporter";

export const Route = createFileRoute("/import/$fcpId")({
  validateSearch: (raw: Record<string, unknown>) => ({
    project: typeof raw.project === "string" ? raw.project : (undefined as string | undefined),
  }),
  component: ImportFcpPage,
});

function ImportFcpPage() {
  const { fcpId } = Route.useParams();
  const { project } = Route.useSearch();
  return (
    <PhotoImporter
      projectId={project ?? null}
      expectedFcpId={fcpId}
      backHref={project ? `/project/${project}` : "/projects"}
      title={`Import photos · FCP ${fcpId}`}
      subtitle="Drop on-site photos. Photos that GPS-snap to a different FCP are flagged."
    />
  );
}
