import { createFileRoute } from "@tanstack/react-router";
import { PhotoImporter } from "@/components/site/PhotoImporter";

export const Route = createFileRoute("/_authenticated/sites/$siteId/import")({
  component: ImportPhotosPage,
});

function ImportPhotosPage() {
  const { siteId } = Route.useParams();
  return <PhotoImporter siteId={siteId} backHref="/dashboard" />;
}
