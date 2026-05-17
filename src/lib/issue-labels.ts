// Turn raw issue tags (from images.issues / match-photo / Gemini) into a
// user-facing label. Returns null for diagnostic-only tags so the UI hides
// them entirely. `severity` lets the caller pick an icon / color.

export type FriendlyIssue = {
  label: string;
  severity: "error" | "warning" | "info";
};

const HIDDEN_PREFIXES = [
  "address:",
  "overlay:",
  "original_gps:",
  "snapped:",
  "faces_blurred:",
];

const HIDDEN_EXACT = new Set(["gps_from_address", "gps_from_overlay", "dev_no_match"]);

const CHECK_LABELS: Record<string, FriendlyIssue> = {
  DEPTH_TOO_SHALLOW: { label: "Trench depth is below the required 60 cm", severity: "error" },
  DEPTH_UNREADABLE: { label: "Depth could not be measured from this photo", severity: "warning" },
  RULER_MISSING: { label: "No measuring ruler visible in the frame", severity: "warning" },
  BEDDING_MISSING: { label: "Sand bedding around cables is not visible", severity: "warning" },
  DUCT_NOT_VISIBLE: { label: "Duct bundle is not visible", severity: "warning" },
  DUCT_BUNDLE_MISSING: { label: "Duct bundle is not visible", severity: "warning" },
  PIPE_ENDS_CUT_OFF: { label: "Pipe ends are out of frame", severity: "warning" },
  PIPE_ENDS_NOT_VISIBLE: { label: "Pipe ends are not visible", severity: "warning" },
  OBSTRUCTED: { label: "View of the trench is obstructed", severity: "warning" },
  LENGTH_UNCLEAR: { label: "Visible trench length cannot be estimated", severity: "warning" },
  SIDE_VIEW_MISSING: { label: "Trench was not photographed from the side", severity: "error" },
  WARNING_TAPE_MISSING: { label: "Warning tape above the cables is not visible", severity: "warning" },
  NO_CABLES_VISIBLE: {
    label: "No cables visible — the trench may be empty or photographed from the wrong angle",
    severity: "error",
  },
  no_gps: { label: "Photo has no GPS metadata", severity: "warning" },
  no_trench: { label: "Photo location does not match any trench on this site", severity: "error" },
  no_waypoint: { label: "Could not snap photo to a waypoint along the trench", severity: "warning" },
  off_site: { label: "Photo location is outside the site boundary", severity: "error" },
};

export function friendlyIssueLabel(raw: string): FriendlyIssue | null {
  if (HIDDEN_EXACT.has(raw)) return null;
  for (const prefix of HIDDEN_PREFIXES) {
    if (raw.startsWith(prefix)) return null;
  }

  let m: RegExpExecArray | null;
  if ((m = /^far_from_waypoint:(\d+)m$/.exec(raw))) {
    return {
      label: `Photo is ${m[1]} m from the nearest expected waypoint`,
      severity: "warning",
    };
  }
  if ((m = /^off_site:(\d+)m$/.exec(raw))) {
    return {
      label: `Photo location is ${m[1]} m outside the site boundary`,
      severity: "error",
    };
  }
  if ((m = /^wrong_fcp:(.+)$/.exec(raw))) {
    return {
      label: `Photo falls in zone ${m[1]} but was uploaded under a different zone`,
      severity: "warning",
    };
  }
  if ((m = /^unknown_fcp:(.+)$/.exec(raw))) {
    return { label: `Zone "${m[1]}" not found in this project`, severity: "warning" };
  }
  if ((m = /^unknown_trench:(.+)$/.exec(raw))) {
    return { label: `Trench "${m[1]}" not found in this project`, severity: "warning" };
  }

  if (CHECK_LABELS[raw]) return CHECK_LABELS[raw];

  // Unknown tag: humanize whatever we got so it's still readable.
  return {
    label: raw.replace(/[_:]/g, " ").replace(/\s+/g, " ").trim(),
    severity: "info",
  };
}

export function friendlyIssues(raw: string[] | null | undefined): FriendlyIssue[] {
  if (!raw) return [];
  const out: FriendlyIssue[] = [];
  for (const r of raw) {
    const f = friendlyIssueLabel(r);
    if (f) out.push(f);
  }
  return out;
}

// Counterpart for `passed_checks` — success-side codes get their own table so
// the analyst sees full sentences instead of `RULER_OK`.
const PASSED_LABELS: Record<string, string> = {
  DEPTH_OK: "Depth meets the 60 cm minimum",
  RULER_OK: "Measuring ruler is visible",
  BEDDING_OK: "Sand bedding is visible",
  DUCT_OK: "Duct bundle is visible",
  PIPE_ENDS_OK: "Pipe ends are in frame",
  UNOBSTRUCTED_OK: "View of the trench is clear",
  LENGTH_OK: "Visible trench length is sufficient",
};

export function friendlyPassedLabel(raw: string): string | null {
  if (raw.startsWith("M:")) return null; // legacy measurement payloads
  return PASSED_LABELS[raw] ?? raw.replace(/_OK$/, "").replace(/_/g, " ").toLowerCase();
}

export function friendlyPassed(raw: string[] | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const r of raw) {
    const f = friendlyPassedLabel(r);
    if (f) out.push(f);
  }
  return out;
}
