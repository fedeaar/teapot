import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type DragEvent } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importGeoJson } from "@/lib/geojson-import.functions";

const IMPORT_TYPES = [
  { value: "clusters", label: "Site Clusters" },
  { value: "fcps", label: "FCPs" },
  { value: "trenches", label: "Trenches" },
  { value: "fcp_polygons", label: "FCP Polygons" },
] as const;

type ImportType = (typeof IMPORT_TYPES)[number]["value"];

export type GeoJsonImporterProps = {
  projectId: string;
  onImported?: () => void;
};

type FileInfo = {
  name: string;
  featureCount: number;
  raw: string;
};

type ImportState =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function GeoJsonImporter({ projectId, onImported }: GeoJsonImporterProps) {
  const [dragOver, setDragOver] = useState(false);
  const [importType, setImportType] = useState<ImportType>("clusters");
  const [file, setFile] = useState<FileInfo | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFn = useServerFn(importGeoJson);

  function processFile(f: File) {
    setParseError(null);
    setState({ kind: "idle" });

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        const parsed = JSON.parse(text);
        if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
          setParseError("Invalid GeoJSON: expected a FeatureCollection with a features array.");
          setFile(null);
          return;
        }
        setFile({
          name: f.name,
          featureCount: parsed.features.length,
          raw: text,
        });
      } catch {
        setParseError("Could not parse file as JSON.");
        setFile(null);
      }
    };
    reader.onerror = () => {
      setParseError("Failed to read file.");
      setFile(null);
    };
    reader.readAsText(f);
  }

  function addFile(files: FileList | File[]) {
    const list = Array.from(files);
    const f = list.find((f) => f.name.endsWith(".geojson") || f.name.endsWith(".json") || f.type === "application/json" || f.type === "application/geo+json");
    if (!f && list.length > 0) {
      // Try the first file anyway
      processFile(list[0]);
      return;
    }
    if (f) processFile(f);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFile(e.dataTransfer.files);
  }

  async function handleImport() {
    if (!file) return;
    setState({ kind: "importing" });
    try {
      const result = await importFn({
        data: { projectId, type: importType, geojson: file.raw },
      });
      const debug = "debug" in result ? `\n${result.debug}` : "";
      if ("inserted" in result) {
        setState({ kind: "success", message: `Inserted ${result.inserted} records${debug}` });
      } else if ("updated" in result) {
        setState({ kind: "success", message: `Updated ${result.updated} records${debug}` });
      } else {
        setState({ kind: "success", message: "Import complete" });
      }
      onImported?.();
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as any).message)
            : JSON.stringify(e);
      setState({ kind: "error", message });
    }
  }

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="card-elevated p-4">
        <label className="block text-sm font-medium mb-1.5">Import type</label>
        <select
          value={importType}
          onChange={(e) => setImportType(e.target.value as ImportType)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {IMPORT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`block card-elevated p-6 border-2 border-dashed cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-surface"
        }`}
      >
        <div className="flex flex-col items-center text-center gap-2">
          <Upload className="w-6 h-6 text-primary" />
          <p className="text-sm font-medium">Drop a GeoJSON file here or click to choose</p>
          <p className="text-xs text-muted-foreground">.geojson or .json with FeatureCollection</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".geojson,.json,application/json,application/geo+json"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFile(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {/* Parse error */}
      {parseError && (
        <div className="card-elevated p-4 flex items-center gap-2 text-danger text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {parseError}
        </div>
      )}

      {/* File info + import button */}
      {file && !parseError && (
        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-3">
            <FileJson className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {file.featureCount} feature{file.featureCount !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            onClick={handleImport}
            disabled={state.kind === "importing" || file.featureCount === 0}
          >
            {state.kind === "importing" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Importing...
              </>
            ) : (
              <>Import {file.featureCount} features</>
            )}
          </Button>
        </div>
      )}

      {/* Success */}
      {state.kind === "success" && (
        <div className="card-elevated p-4 flex items-center gap-2 text-success text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {state.message}
        </div>
      )}

      {/* Error */}
      {state.kind === "error" && (
        <div className="card-elevated p-4 flex items-center gap-2 text-danger text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {state.message}
        </div>
      )}
    </div>
  );
}
