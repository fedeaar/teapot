import { CheckCircle2, XCircle } from "lucide-react";
import { friendlyIssues, friendlyPassed } from "@/lib/issue-labels";

// Shared issues / passed list used by both the map photo popup and the
// full-page result view so the two read identically.
export function PhotoChecklist({
  failedChecks,
  passedChecks,
  recommendation,
}: {
  failedChecks?: string[] | null;
  passedChecks?: string[] | null;
  recommendation?: string | null;
}) {
  const issues = friendlyIssues(failedChecks);
  const passed = friendlyPassed(passedChecks);
  if (issues.length === 0 && passed.length === 0 && !recommendation) return null;
  return (
    <div className="space-y-2">
      {issues.length > 0 && (
        <div className="card-elevated border-danger/30 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-danger font-semibold">
            Issues
          </div>
          {issues.map((f, i) => {
            const tone =
              f.severity === "error"
                ? "text-danger"
                : f.severity === "warning"
                  ? "text-warning"
                  : "text-muted-foreground";
            return (
              <div key={f.label + i} className="flex items-start gap-2 text-xs leading-snug">
                <XCircle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${tone}`} />
                <span>{f.label}</span>
              </div>
            );
          })}
          {recommendation && (
            <p className="text-[11px] text-warning mt-2 pt-2 border-t border-border leading-snug">
              {recommendation}
            </p>
          )}
        </div>
      )}
      {passed.length > 0 && (
        <div className="card-elevated p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Passed
          </div>
          {passed.map((label, i) => (
            <div key={label + i} className="flex items-start gap-2 text-xs leading-snug">
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <span className="capitalize first-letter:uppercase">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
