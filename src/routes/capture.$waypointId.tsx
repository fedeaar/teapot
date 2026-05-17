import { createFileRoute, useNavigate, Link, ClientOnly } from "@tanstack/react-router";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { sealPhoto } from "@/lib/seal";
import { haversine } from "@/lib/geo";
import { WAYPOINT_FLAG_M } from "@/lib/match-photo";
import { injectGpsExif } from "@/lib/exif-write";

const DEV_BYPASS_DISTANCE = true;
import { Camera, Loader2, X, MapPin } from "lucide-react";
import { motion } from "framer-motion";

const CaptureMiniMap = lazy(() =>
  import("@/components/site/CaptureMiniMap").then((m) => ({ default: m.CaptureMiniMap })),
);

const searchSchema = z.object({
  fcp: z.string(),
  lat: z.number(),
  lng: z.number(),
  trench: z.string().optional(),
  project: z.string().uuid().optional(),
  cluster: z.string().uuid().optional(),
});

export const Route = createFileRoute("/capture/$waypointId")({
  validateSearch: searchSchema,
  component: CapturePage,
});

function CapturePage() {
  const { fcp, lat, lng, trench, project: projectId, cluster: clusterId } = Route.useSearch();
  const { waypointId } = Route.useParams();
  const waypointIndex = Number.isFinite(Number(waypointId)) ? Number(waypointId) : null;
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamReady(true);
        }
      } catch (e: any) {
        setError(e?.message ?? "Camera access denied");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setCoords({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const canShoot = streamReady && !busy;

  async function shoot() {
    if (!videoRef.current) return;

    // Location gate: block uploads when the worker isn't actually at the point.
    if (!coords) {
      setError("Waiting for GPS — move outside and try again.");
      return;
    }
    const distanceM = haversine({ lat: coords.lat, lng: coords.lng }, { lat, lng });
    if (!DEV_BYPASS_DISTANCE && distanceM > WAYPOINT_FLAG_M) {
      setError(
        `You're ${Math.round(distanceM)} m from the capture point. Move within ${WAYPOINT_FLAG_M} m and retake.`,
      );
      return;
    }

    setBusy(true);
    try {
      const v = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(v, 0, 0);

      const capturedAt = new Date().toISOString();
      const stamp = `${lat.toFixed(6)}, ${lng.toFixed(6)}  •  ${new Date(capturedAt).toLocaleString()}  •  ${fcp}${trench ? ` · ${trench}` : ""}`;
      const pad = Math.max(12, canvas.width * 0.015);
      const fs = Math.max(18, canvas.width * 0.022);
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      const tw = ctx.measureText(stamp).width;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(pad - 8, canvas.height - fs - pad - 8, tw + 16, fs + 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(stamp, pad, canvas.height - pad);

      const rawBlob: Blob = await new Promise((r) =>
        canvas.toBlob((b) => r(b!), "image/jpeg", 0.9),
      );
      // canvas.toBlob() emits no EXIF — inject GPS + capture time so the JPEG
      // carries provenance on download and the analyst re-import flow (which
      // reads EXIF first) doesn't have to fall back to OCR.
      const bytes = injectGpsExif(await rawBlob.arrayBuffer(), {
        lat: coords.lat,
        lng: coords.lng,
        accuracyM: coords.accuracy,
        capturedAt,
      });
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const { sha256, sealId } = await sealPhoto(bytes, lat, lng, capturedAt);

      const filename = `${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(filename, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("photos").getPublicUrl(filename);

      const { data: inserted, error: insErr } = await supabase
        .from("images")
        .insert({
          image_url: pub.publicUrl,
          filename,
          latitude: lat,
          longitude: lng,
          captured_at: capturedAt,
          fcp_id: fcp,
          trench_id: trench ?? null,
          project_id: projectId ?? null,
          cluster_id: clusterId ?? null,
          waypoint_index: waypointIndex,
          sha256,
          status: "pending",
          image_width: canvas.width,
          image_height: canvas.height,
          file_size_bytes: blob.size,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      navigate({ to: "/result/$photoId", params: { photoId: inserted!.id } });
    } catch (e: any) {
      setError(e?.message ?? "Capture failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-8 border-2 border-white/30 rounded-2xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-white/60 text-center max-w-[60%]">
          Place a folding rule against the trench wall for depth reading
        </div>
      </div>

      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-[120px] h-[150px] sm:w-[140px] sm:h-[180px] rounded-xl overflow-hidden border border-white/20 shadow-2xl bg-black/60 backdrop-blur">
        <ClientOnly
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-white/60" />
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-white/60" />
              </div>
            }
          >
            <CaptureMiniMap target={{ lat, lng }} user={coords} />
          </Suspense>
        </ClientOnly>
      </div>

      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between">
        <Link
          to="/zone/$fcpId"
          params={{ fcpId: fcp }}
          className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </Link>
        <div className="bg-black/60 backdrop-blur rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-primary" />
          {coords ? (
            <span className="font-mono">±{coords.accuracy.toFixed(1)}m</span>
          ) : (
            <span>no GPS</span>
          )}
        </div>
        <div className="bg-primary/20 border border-primary/50 rounded-full px-3 py-1.5 text-xs">
          {fcp}
        </div>
      </div>

      <div className="absolute top-20 inset-x-0 flex justify-center">
        <motion.div
          key={String(streamReady)}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/60 backdrop-blur rounded-full px-4 py-2 text-sm"
        >
          {!streamReady && !error && (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Starting camera…
            </span>
          )}
          {error && <span className="text-danger">{error}</span>}
          {streamReady && (
            <span className="text-success">Ready — frame the trench cross-section</span>
          )}
        </motion.div>
      </div>

      <div className="absolute bottom-0 inset-x-0 pb-10 flex justify-center">
        <button
          onClick={shoot}
          disabled={!canShoot}
          className={`relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-opacity ${
            canShoot ? "opacity-100" : "opacity-40"
          }`}
        >
          <div
            className={`w-16 h-16 rounded-full ${
              canShoot ? "bg-success ring-pulse" : "bg-white/40"
            } flex items-center justify-center`}
          >
            {busy ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : (
              <Camera className="w-6 h-6 text-white" />
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
