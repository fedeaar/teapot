import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PhotoImporter } from "@/components/site/PhotoImporter";
import { UploadedPhotosSection } from "@/components/site/UploadedPhotosSection";

export const Route = createFileRoute("/import")({
  validateSearch: (raw: Record<string, unknown>) => ({
    project: typeof raw.project === "string" ? raw.project : (undefined as string | undefined),
  }),
  component: ImportPage,
});

function ImportPage() {
  const { project } = Route.useSearch();
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <PhotoImporter
        projectId={project ?? ""}
        backHref={project ? `/project/${project}` : "/projects"}
        title="Import photos"
        subtitle="Drop photos. We auto-detect FCP, trench, and waypoint from each photo's GPS — falling back to OCR of the overlay if EXIF is missing."
        onImported={() => setRefreshKey((k) => k + 1)}
      />
      <div className="max-w-6xl mx-auto px-4 pb-12">
        <UploadedPhotosSection refreshKey={refreshKey} />
      </div>
    </>
  );
}
