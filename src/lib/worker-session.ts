const STORAGE_KEY = "worker_session_v1";

export type WorkerSession = {
  siteId: string;
  siteName: string;
  code: string;
  expiresAt: string;
};

export function saveWorkerSession(s: WorkerSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function getWorkerSession(): WorkerSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as WorkerSession;
    if (new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearWorkerSession() {
  localStorage.removeItem(STORAGE_KEY);
}
