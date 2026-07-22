"use client";
/* eslint-disable react-hooks/set-state-in-effect -- effects synchronize API polling and browser session state. */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { subscribeToQueue } from "@/lib/client/realtime";

const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? "2026-07-22";
const STORAGE_KEY = "supa-q-session";

type Site = {
  id: string;
  name: string;
  address: string;
  prefecture?: string | null;
  municipality?: string | null;
  searchText?: string | null;
  stallCount: number;
};

type SiteSummary = {
  siteId: string;
  queueEnabled: boolean;
  waitingCount: number;
  estimatedWaitMinutes: number;
  queueVersion: number;
};

type QueueStatus = "waiting" | "notified" | "called" | "charging";
type Snapshot = {
  entryId: string;
  status: QueueStatus;
  position: number | null;
  aheadCount: number | null;
  estimatedStartAt: string | null;
  estimatedWaitMinutes: number | null;
  estimateConfidence: "confirmed" | "provisional" | "unknown";
  calledAt: string | null;
  callExpiresAt: string | null;
  chargingStartedAt: string | null;
  expectedFinishAt: string | null;
  finishConfirmationExpiresAt: string | null;
  canStart: boolean;
  canSkipStart: boolean;
  canSetDuration: boolean;
  canExtend: boolean;
  canComplete: boolean;
  queueVersion: number;
};

type View =
  | "search"
  | "detail"
  | "join"
  | "full-confirm"
  | "notify"
  | "waiting"
  | "soon"
  | "called"
  | "duration"
  | "charging"
  | "finish-confirm"
  | "extend"
  | "complete"
  | "expired"
  | "left"
  | "recovery";

type StoredSession = { entryId: string; token: string; siteId: string; nickname: string };
type ApiFailure = { code?: string; message: string; retryable?: boolean };

type OneSignalClient = {
  init(options: { appId: string; allowLocalhostAsSecureOrigin?: boolean }): Promise<void>;
  Notifications: { requestPermission(): Promise<void> };
  User: { PushSubscription: { id?: string | null } };
};

type TurnstileClient = {
  render(element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(client: OneSignalClient) => void | Promise<void>>;
    turnstile?: TurnstileClient;
  }
}

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.entryId !== "string" || typeof value.token !== "string" || typeof value.siteId !== "string" || typeof value.nickname !== "string") return null;
    return value as StoredSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing can reject storage. The API response is still useful for this tab.
  }
}

function clearStoredSession() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("x-queue-token", token);
  if (init.method?.toUpperCase() === "POST" && !headers.has("idempotency-key") && typeof crypto !== "undefined") headers.set("idempotency-key", crypto.randomUUID());
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: "no-store" });
  } catch {
    throw { message: "通信できませんでした。接続を確認して、もう一度お試しください。", retryable: true } satisfies ApiFailure;
  }
  let body: { data?: T; error?: ApiFailure } | null = null;
  try { body = await response.json() as { data?: T; error?: ApiFailure }; } catch { /* handled below */ }
  if (!response.ok || !body?.data) {
    throw body?.error ?? { message: response.status === 503 ? "サーバーの設定を確認できないため、現在この操作を利用できません。" : "処理を完了できませんでした。時間をおいて、もう一度お試しください。", retryable: response.status >= 500 };
  }
  return body.data;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function minutesRemaining(value: string | null) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60_000));
}

function useCountdownSeconds(value: string | null) {
  const targetTime = value ? new Date(value).getTime() : 0;
  const getRemainingSeconds = useCallback(() => Math.max(0, Math.ceil((targetTime - Date.now()) / 1_000)), [targetTime]);
  const [remainingSeconds, setRemainingSeconds] = useState(getRemainingSeconds);

  useEffect(() => {
    const update = () => setRemainingSeconds(getRemainingSeconds());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [getRemainingSeconds]);

  return remainingSeconds;
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const selector = "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
    const focusables = () => Array.from(modal.querySelectorAll<HTMLElement>(selector));
    const previous = document.activeElement as HTMLElement | null;
    (focusables()[0] ?? modal).focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const current = focusables();
      if (!current.length) { event.preventDefault(); return; }
      const first = current[0]; const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    modal.addEventListener("keydown", handler);
    return () => { modal.removeEventListener("keydown", handler); previous?.focus(); };
  }, [ref, onClose]);
}

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [nickname, setNickname] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [duration, setDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState("");
  const [extensionMinutes, setExtensionMinutes] = useState(15);
  const [customExtension, setCustomExtension] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [skipStartOpen, setSkipStartOpen] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const pollRef = useRef<number | null>(null);
  const lastFailureRef = useRef<ApiFailure | null>(null);
  const knownQueueVersionRef = useRef(0);
  const terminalTransitionRef = useRef(false);
  const pendingIdempotencyKeysRef = useRef(new Map<string, string>());
  const idempotencyKeyFor = (scope: string, fingerprint: unknown): string => {
    const key = `${scope}:${JSON.stringify(fingerprint)}`;
    const existing = pendingIdempotencyKeysRef.current.get(key);
    if (existing) return existing;
    const generated = typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    pendingIdempotencyKeysRef.current.set(key, generated);
    return generated;
  };
  const clearIdempotencyKey = (scope: string, fingerprint: unknown) => {
    pendingIdempotencyKeysRef.current.delete(`${scope}:${JSON.stringify(fingerprint)}`);
  };

  const filteredSites = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
    if (!normalized) return sites;
    const searchable = (item: Site) => [item.name, item.address, item.prefecture, item.municipality, item.searchText].filter(Boolean).join(" ").toLocaleLowerCase("ja-JP");
    return sites.filter((item) => searchable(item).includes(normalized)).sort((a, b) => {
      const aText = searchable(a); const bText = searchable(b);
      return Number(!aText.startsWith(normalized)) - Number(!bText.startsWith(normalized));
    });
  }, [query, sites]);

  const showError = (reason: unknown) => {
    const failure = reason as ApiFailure;
    setError({ message: failure?.message ?? "処理を完了できませんでした。時間をおいて、もう一度お試しください。", code: failure?.code, retryable: failure?.retryable });
  };

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ sites: Site[] }>("/api/sites");
      setSites(result.sites ?? []);
      setError(null);
    } catch (reason) { showError(reason); } finally { setLoading(false); }
  }, []);

  const restore = useCallback(async (stored: StoredSession) => {
    try {
      const result = await api<Snapshot>(`/api/queue/me?entryId=${encodeURIComponent(stored.entryId)}`, {}, stored.token);
      const currentSite = sites.find((item) => item.id === stored.siteId) ?? null;
      setSession(stored); setNickname(stored.nickname); setSite(currentSite); setSnapshot(result); setView(toQueueView(result)); setError(null);
    } catch (reason) {
      clearStoredSession();
      setSite(sites.find((item) => item.id === stored.siteId) ?? null);
      setSession(null); setSnapshot(null); setView("recovery"); showError(reason);
    }
  }, [sites]);

  useEffect(() => { void loadSites(); }, [loadSites]);
  useEffect(() => {
    const stored = readStoredSession();
    if (stored) setSession(stored);
  }, []);
  useEffect(() => {
    if (loading || !session || !sites.length) return;
    if (snapshot) return;
    void restore(session);
  }, [loading, session, sites, snapshot, restore]);

  const fetchSummary = useCallback(async (selected: Site) => {
    setBusy(true); setError(null);
    try {
      const next = await api<SiteSummary>(`/api/sites/${encodeURIComponent(selected.id)}/summary`);
      knownQueueVersionRef.current = next.queueVersion;
      setSummary(next); setSite(selected); setView("detail");
    }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!session || terminalTransitionRef.current) return;
    const currentFinishConfirmationExpiresAt = snapshot?.finishConfirmationExpiresAt;
    try {
      const result = await api<Snapshot>(`/api/queue/me?entryId=${encodeURIComponent(session.entryId)}`, {}, session.token);
      if (terminalTransitionRef.current) return;
      knownQueueVersionRef.current = result.queueVersion;
      setSnapshot(result);
      setView((current) => current === "duration" || current === "extend" || current === "finish-confirm" ? current : toQueueView(result));
      if (result.status === "charging" && result.finishConfirmationExpiresAt && new Date(result.finishConfirmationExpiresAt).getTime() <= Date.now()) {
        terminalTransitionRef.current = true;
        setAutoCompleted(true); clearStoredSession(); setSession(null); setSnapshot(null); setView("complete");
      }
    } catch (reason) {
      if (terminalTransitionRef.current) return;
      const failure = reason as ApiFailure;
      if (failure.code === "ENTRY_NOT_FOUND" || failure.code === "MANAGEMENT_TOKEN_INVALID") {
        const expiredCall = view === "called";
        const autoFinished = view === "charging" && !!currentFinishConfirmationExpiresAt && new Date(currentFinishConfirmationExpiresAt).getTime() <= Date.now();
        clearStoredSession(); setSession(null);
        if (expiredCall) setView("expired");
        else if (autoFinished) { setAutoCompleted(true); setView("complete"); }
        else setView("recovery");
      }
      else showError(reason);
    }
  }, [session, view, snapshot?.finishConfirmationExpiresAt]);

  useEffect(() => {
    if (!session || !["waiting", "soon", "called", "charging"].includes(view)) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => void refreshQueue(), 15_000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [session, view, refreshQueue]);

  useEffect(() => {
    if (!site || !["detail", "waiting", "soon", "called", "charging", "finish-confirm", "extend"].includes(view)) return;
    return subscribeToQueue(site.id, (payload) => {
      if (payload.queueVersion <= knownQueueVersionRef.current) return;
      if (session) void refreshQueue();
      else void fetchSummary(site);
    });
  }, [site, session, view, refreshQueue, fetchSummary]);

  useEffect(() => {
    if (!site || view !== "detail") return;
    const timer = window.setInterval(() => void fetchSummary(site), 15_000);
    return () => window.clearInterval(timer);
  }, [site, view, fetchSummary]);

  useEffect(() => {
    if (view !== "charging" || !snapshot?.expectedFinishAt) return;
    const due = new Date(snapshot.expectedFinishAt).getTime() - Date.now() <= 3 * 60_000;
    if (due && snapshot.canExtend) setView("finish-confirm");
  }, [view, snapshot]);

  const join = async (siteIsFull: boolean) => {
    if (!site || !nickname.trim() || !acceptedTerms) return;
    terminalTransitionRef.current = false;
    setBusy(true); setError(null);
    const input = { siteId: site.id, nickname: nickname.trim(), siteIsFull, acceptedTerms: true, termsVersion: TERMS_VERSION, turnstileToken: turnstileToken || undefined };
    const keyFingerprint = { operation: "join", siteId: input.siteId, nickname: input.nickname, siteIsFull: input.siteIsFull, acceptedTerms: input.acceptedTerms, termsVersion: input.termsVersion };
    const idempotencyKey = idempotencyKeyFor("join", keyFingerprint);
    try {
      const result = await api<{ entryId: string; managementToken: string; snapshot: Snapshot }>("/api/queue/join", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) });
      clearIdempotencyKey("join", keyFingerprint);
      const next = { entryId: result.entryId, token: result.managementToken, siteId: site.id, nickname: nickname.trim() };
      knownQueueVersionRef.current = result.snapshot.queueVersion;
      writeStoredSession(next); setSession(next); setSnapshot(result.snapshot); setView("notify");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  };

  const mutate = async (path: string, body: Record<string, unknown>, next?: View) => {
    if (!session) { setView("recovery"); return; }
    setBusy(true); setError(null); lastFailureRef.current = null;
    const keyFingerprint = { operation: path, entryId: session.entryId, ...body };
    const idempotencyKey = idempotencyKeyFor(path, keyFingerprint);
    try {
      const result = await api<{ snapshot: Snapshot }>(path, { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify({ ...body, entryId: session.entryId }) }, session.token);
      clearIdempotencyKey(path, keyFingerprint);
      if (result.snapshot) setSnapshot(result.snapshot);
      if (next) setView(next);
      return result.snapshot;
    } catch (reason) { lastFailureRef.current = reason as ApiFailure; showError(reason); return null; } finally { setBusy(false); }
  };

  const startCharging = async () => { const next = await mutate("/api/queue/start", {}); if (next) setView("duration"); else if (lastFailureRef.current?.code === "CALL_EXPIRED") { clearStoredSession(); setSession(null); setView("expired"); } };
  const skipWaitAndStartCharging = async () => { const next = await mutate("/api/queue/skip-start", {}); if (next) { setSkipStartOpen(false); setView("duration"); } };
  const setInitialDuration = async () => { const value = customDuration ? Number(customDuration) : duration; if (!Number.isInteger(value) || value < 5 || value > 120) { setError({ message: "充電時間は5〜120分の整数で入力してください。" }); return; } const next = await mutate("/api/queue/duration", { minutes: value }); if (next) { setDuration(value); setView("charging"); } };
  const extend = async () => { const value = customExtension ? Number(customExtension) : extensionMinutes; if (!Number.isInteger(value) || value < 5 || value > 120) { setError({ message: "延長時間は5〜120分の整数で入力してください。" }); return; } const next = await mutate("/api/queue/extend", { additionalMinutes: value }); if (next) { setExtensionMinutes(value); setView("charging"); } };
  const complete = async () => {
    terminalTransitionRef.current = true;
    const next = await mutate("/api/queue/complete", {});
    if (!next) { terminalTransitionRef.current = false; return; }
    clearStoredSession(); setSession(null); setSnapshot(null); setError(null); setAutoCompleted(false); setView("complete");
  };
  const cancel = async () => {
    terminalTransitionRef.current = true;
    const next = await mutate("/api/queue/cancel", {});
    if (!next) { terminalTransitionRef.current = false; return; }
    clearStoredSession(); setSession(null); setSnapshot(null); setError(null); setCancelOpen(false); setView("left");
  };
  const enableNotifications = async () => {
    if (!session) return;
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId || typeof window === "undefined") {
      setError({ code: "PUSH_NOT_SUPPORTED", message: "この環境ではプッシュ通知を設定できません。この画面で順番をご確認ください。" });
      return;
    }
    setBusy(true); setError(null);
    try {
      const subscriptionId = await new Promise<string>((resolve, reject) => {
        const deferred = window.OneSignalDeferred ?? (window.OneSignalDeferred = []);
        const timer = window.setTimeout(() => reject({ code: "PUSH_REGISTRATION_FAILED", message: "通知を設定できませんでした。待ち列は維持されています。もう一度お試しください。", retryable: true } satisfies ApiFailure), 7_000);
        deferred.push(async (client) => {
          try {
            await client.init({ appId, allowLocalhostAsSecureOrigin: true });
            await client.Notifications.requestPermission();
            const id = client.User.PushSubscription.id;
            if (!id) throw new Error("push subscription is not available");
            window.clearTimeout(timer); resolve(id);
          } catch {
            window.clearTimeout(timer);
            reject({ code: "PUSH_REGISTRATION_FAILED", message: "通知を設定できませんでした。待ち列は維持されています。もう一度お試しください。", retryable: true } satisfies ApiFailure);
          }
        });
      });
      const next = await mutate("/api/queue/push-subscription", { subscriptionId });
      if (next) setView(toQueueView(next));
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  };

  const back = () => {
    setError(null);
    if (view === "detail") { setView("search"); return; }
    if (view === "join" || view === "full-confirm") { setView("detail"); return; }
    if (view === "extend" || view === "finish-confirm") { setView("charging"); return; }
    if (view === "recovery") { setView("search"); return; }
    if (["waiting", "soon", "called", "duration", "charging", "notify"].includes(view)) return;
    setView("search");
  };

  const title = viewTitle(view);
  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="icon-button" onClick={back} aria-label="戻る" disabled={view === "search" || view === "complete" || view === "left" || view === "expired"}>‹</button>
        <Link className="brand" href="/" aria-label="スパQのホームへ戻る"><span className="brand-mark" aria-hidden="true">Q</span><strong>スパQ</strong></Link>
        <span className="header-spacer" aria-hidden="true" />
      </header>
      <div className="app-content">
        {error && <div className="error-alert" role="alert"><span aria-hidden="true">!</span><p>{error.message}</p>{error.retryable && <button onClick={() => { setError(null); if (view === "search") void loadSites(); else if (session) void refreshQueue(); }}>再試行</button>}</div>}
        {loading && view === "search" ? <div className="screen center-state" role="status"><span className="spinner" />施設を読み込んでいます…</div> : null}
        {!loading && view === "search" && <SearchScreen query={query} setQuery={setQuery} sites={filteredSites} total={sites.length} onSelect={(selected) => void fetchSummary(selected)} busy={busy} />}
        {view === "detail" && site && <DetailScreen site={site} summary={summary} onBack={back} onJoin={() => { setAcceptedTerms(false); setTurnstileToken(""); setView("join"); }} busy={busy} />}
        {view === "join" && site && <JoinScreen site={site} nickname={nickname} setNickname={setNickname} acceptedTerms={acceptedTerms} setAcceptedTerms={setAcceptedTerms} turnstileToken={turnstileToken} setTurnstileToken={setTurnstileToken} onSubmit={() => { if (summary?.waitingCount) void join(false); else setView("full-confirm"); }} onBack={back} busy={busy} />}
        {view === "full-confirm" && site && <FullConfirmScreen site={site} turnstileToken={turnstileToken} setTurnstileToken={setTurnstileToken} onConfirm={() => void join(true)} onBack={back} />}
        {view === "notify" && <NotifyScreen onEnable={() => void enableNotifications()} onLater={() => setView(toQueueView(snapshot))} busy={busy} available={Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID)} />}
        {(view === "waiting" || view === "soon") && snapshot && <WaitingScreen snapshot={snapshot} nickname={nickname} soon={view === "soon"} onCancel={() => setCancelOpen(true)} onSkipStart={() => setSkipStartOpen(true)} busy={busy} />}
        {view === "called" && snapshot && <CalledScreen snapshot={snapshot} onStart={() => void startCharging()} onCancel={() => setCancelOpen(true)} busy={busy} />}
        {view === "duration" && <DurationScreen duration={duration} setDuration={setDuration} custom={customDuration} setCustom={setCustomDuration} expected={snapshot?.chargingStartedAt ? new Date(new Date(snapshot.chargingStartedAt).getTime() + (Number(customDuration) || duration) * 60_000) : null} onConfirm={() => void setInitialDuration()} busy={busy} />}
        {view === "charging" && snapshot && <ChargingScreen snapshot={snapshot} onComplete={() => void complete()} onFinishCheck={() => setView("finish-confirm")} busy={busy} />}
        {view === "finish-confirm" && snapshot && <FinishConfirmScreen snapshot={snapshot} onComplete={() => void complete()} onExtend={() => setView("extend")} onBack={back} busy={busy} />}
        {view === "extend" && snapshot && <ExtendScreen minutes={extensionMinutes} setMinutes={setExtensionMinutes} custom={customExtension} setCustom={setCustomExtension} snapshot={snapshot} onConfirm={() => void extend()} onBack={back} busy={busy} />}
        {view === "complete" && <ResultScreen kind="complete" autoCompleted={autoCompleted} onHome={() => { setSite(null); setSummary(null); setView("search"); }} />}
        {view === "expired" && <ResultScreen kind="expired" onHome={() => { setSite(null); setSummary(null); setView("search"); }} />}
        {view === "left" && <ResultScreen kind="left" onHome={() => { setSite(null); setSummary(null); setView("search"); }} />}
        {view === "recovery" && <RecoveryScreen onSearch={() => { setError(null); if (site) void fetchSummary(site); else setView("search"); }} />}
      </div>
      {cancelOpen && <CancelDialog busy={busy} onConfirm={() => void cancel()} onClose={() => setCancelOpen(false)} />}
      {skipStartOpen && <SkipStartDialog busy={busy} onConfirm={() => void skipWaitAndStartCharging()} onClose={() => setSkipStartOpen(false)} />}
      <span className="sr-only">{title}</span>
    </main>
  );
}

function toQueueView(value: Snapshot | null): View { if (!value) return "waiting"; if (value.status === "called") return "called"; if (value.status === "charging") return value.canSetDuration ? "duration" : "charging"; return value.status === "notified" || (value.estimatedWaitMinutes !== null && value.estimatedWaitMinutes <= 5) ? "soon" : "waiting"; }
function viewTitle(view: View) { return ({ search: "施設検索", detail: "施設詳細", join: "待ち列に参加", "full-confirm": "満車確認", notify: "参加完了", waiting: "待機中", soon: "5分前", called: "順番到来", duration: "充電時間", charging: "充電中", "finish-confirm": "終了確認", extend: "延長", complete: "完了", expired: "呼び出し失効", left: "退出", recovery: "セッション復旧" })[view]; }

function SearchScreen({ query, setQuery, sites, total, onSelect, busy }: { query: string; setQuery: (value: string) => void; sites: Site[]; total: number; onSelect: (site: Site) => void; busy: boolean }) {
  return <section className="screen"><p className="eyebrow">スパQ</p><h1>施設を探す</h1><p className="lead">施設名・住所・都道府県から検索できます。</p><label className="search-field"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：有明、東京都、港区" aria-label="施設名や住所で検索" /><button type="button" onClick={() => setQuery("")} disabled={!query}>クリア</button></label><div className="result-head"><strong>{query.trim() ? "検索結果" : "施設一覧"}</strong><span>{query.trim() ? `${sites.length}件` : `${total}件`}</span></div>{busy && <p className="inline-status">読み込んでいます…</p>}{!sites.length && <div className="empty-card"><strong>{query.trim() ? "該当する施設がありません" : "施設を表示できません"}</strong><p>{query.trim() ? "別のキーワードで検索してください。" : "サーバーの設定を確認して、もう一度お試しください。"}</p></div>}<div className="site-list">{sites.slice(0, 20).map((item) => <button key={item.id} className="site-card" onClick={() => onSelect(item)}><span className="site-status"><i />待ち列を確認</span><h2>{item.name}</h2><p>{item.address}</p><span className="site-meta">ストール {item.stallCount}基 <b>›</b></span></button>)}</div><p className="footnote">待ち時間は参考値です。現地の空き状況と施設ルールを最優先してください。</p></section>;
}

function DetailScreen({ site, summary, onBack, onJoin, busy }: { site: Site; summary: SiteSummary | null; onBack: () => void; onJoin: () => void; busy: boolean }) {
  const waiting = summary?.waitingCount ?? 0;
  return <section className="screen"><button className="back-link" onClick={onBack}>‹ 施設検索へ</button><div className="detail-heading"><span className={`site-status ${waiting ? "busy" : "open"}`}><i />{waiting ? "待ち列あり" : "待ち列なし"}</span><h1>{site.name}</h1><p>{site.address}</p></div><div className="summary-card"><div><strong>{waiting}</strong><span>人が待機中</span></div><div><strong>{summary?.estimatedWaitMinutes ?? 0}<small>分</small></strong><span>待ち時間の目安</span></div></div><div className="detail-row"><span>充電ストール</span><strong>{site.stallCount}基</strong></div><div className="notice-card"><strong>現地を最優先にしてください</strong><p>表示している待ち時間はアプリ上の参考値です。現地の空き・施設ルール・実際の並び順を確認してください。</p></div>{summary?.queueEnabled === false ? <div className="empty-card"><strong>現在、待ち列を受け付けていません</strong><p>現地の案内をご確認ください。</p></div> : <button className="primary-button" onClick={onJoin} disabled={busy}>{busy ? "読み込んでいます…" : "満車で待ち列に参加"}</button>}<p className="button-note">ログイン・電話番号は不要です</p></section>;
}

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | undefined;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (!window.turnstile || !containerRef.current) {
        attempts += 1;
        if (attempts > 50) { window.clearInterval(timer); setStatus("error"); }
        return;
      }
      window.clearInterval(timer);
      try {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => { onToken(token); setStatus("ready"); },
          "expired-callback": () => { onToken(""); setStatus("loading"); },
          "error-callback": () => { onToken(""); setStatus("error"); },
        });
      } catch { setStatus("error"); }
    }, 200);
    return () => { window.clearInterval(timer); if (widgetId && window.turnstile) window.turnstile.remove(widgetId); };
  }, [onToken, siteKey]);
  if (!siteKey) return null;
  return <div className="turnstile-block" aria-live="polite"><div ref={containerRef} />{status === "loading" && <p>操作確認を読み込んでいます…</p>}{status === "error" && <p>操作確認を表示できません。通信を確認して再読み込みしてください。</p>}</div>;
}

function JoinScreen({ site, nickname, setNickname, acceptedTerms, setAcceptedTerms, turnstileToken, setTurnstileToken, onSubmit, onBack, busy }: { site: Site; nickname: string; setNickname: (value: string) => void; acceptedTerms: boolean; setAcceptedTerms: (value: boolean) => void; turnstileToken: string; setTurnstileToken: (value: string) => void; onSubmit: () => void; onBack: () => void; busy: boolean }) {
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  return <section className="screen"><button className="back-link" onClick={onBack}>‹ 施設詳細へ</button><p className="eyebrow">JOIN THE QUEUE</p><h1>待ち列に参加</h1><p className="lead">{site.name}での順番を確認します。ニックネームだけで参加できます。</p><label className="field-label" htmlFor="nickname">ニックネーム（1〜30文字）</label><input id="nickname" className="text-input" autoFocus value={nickname} maxLength={30} onChange={(event) => setNickname(event.target.value)} placeholder="例：白いModel 3" /><label className="terms-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>利用規約およびプライバシーポリシーに同意する</span></label><p className="legal-links"><a href="/terms" target="_blank" rel="noreferrer">利用規約</a> ・ <a href="/privacy" target="_blank" rel="noreferrer">プライバシーポリシー</a></p>{turnstileRequired && <TurnstileWidget onToken={setTurnstileToken} />}<div className="notice-card"><strong>現地が満車であることを確認してください</strong><p>アプリ上の待ち時間は参考値です。現地を最優先にしてください。</p></div><button className="primary-button" onClick={onSubmit} disabled={busy || !nickname.trim() || !acceptedTerms || (turnstileRequired && !turnstileToken)}>{busy ? "参加しています…" : "待ち列に参加する"}</button><button className="text-button" onClick={onBack}>戻る</button></section>;
}

function FullConfirmScreen({ site, turnstileToken, setTurnstileToken, onConfirm, onBack }: { site: Site; turnstileToken: string; setTurnstileToken: (value: string) => void; onConfirm: () => void; onBack: () => void }) { const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY); return <section className="screen"><p className="eyebrow">FULL CONFIRMATION</p><h1>現地が満車ですか？</h1><p className="lead">{site.name}ではアプリ上の待機者がいません。</p><div className="notice-card warning"><strong>満車を確認して待ち列を開始</strong><p>確定した終了時刻がないストールは、45分後に空く暫定値として計算します。現地の状況と施設ルールを最優先にしてください。</p></div>{turnstileRequired && <TurnstileWidget onToken={setTurnstileToken} />}<button className="primary-button" onClick={onConfirm} disabled={turnstileRequired && !turnstileToken}>満車を確認して続ける</button><button className="text-button" onClick={onBack}>施設詳細へ戻る</button></section>; }

function NotifyScreen({ onEnable, onLater, busy, available }: { onEnable: () => void; onLater: () => void; busy: boolean; available: boolean }) { return <section className="screen result-screen"><div className="result-mark">✓</div><p className="eyebrow">YOU ARE IN</p><h1>待ち列に参加しました</h1><p className="lead">順番の5分前と順番到来を、この画面でお知らせします。</p><div className="notice-card"><strong>{available ? "通知を受け取る（任意）" : "この環境ではWeb Pushを利用できません"}</strong><p>{available ? "ブラウザ通知を許可すると、画面を閉じていても気づきやすくなります。iPhone/iPadはホーム画面に追加すると通知を受け取れます。" : "待ち列画面を開いている間は画面内で状態を確認できます。通知なしでも待ち列は利用できます。"}</p></div>{available && <button className="primary-button" onClick={onEnable} disabled={busy}>{busy ? "設定しています…" : "通知を受け取る"}</button>}<button className={available ? "text-button" : "primary-button"} onClick={onLater}>{available ? "あとで" : "待機画面へ"}</button></section>; }

function WaitingScreen({ snapshot, nickname, soon, onCancel, onSkipStart, busy }: { snapshot: Snapshot; nickname: string; soon: boolean; onCancel: () => void; onSkipStart: () => void; busy: boolean }) { const ahead = snapshot.aheadCount ?? 0; const wait = snapshot.estimatedWaitMinutes ?? 0; return <section className={`screen queue-screen ${soon ? "is-soon" : ""}`}>{soon && <div className="notice-banner"><strong>まもなく順番です</strong><span>施設付近へ戻ってください。順番になると5分の受付時間が始まります。</span></div>}<p className="eyebrow">YOUR QUEUE</p><h1>{nickname}<small>さんの待ち状況</small></h1><div className="position-orbit"><span>現在</span><strong>{snapshot.position ?? ahead + 1}</strong><small>番目</small></div><div className="queue-facts"><div><span>あなたの前</span><strong>{ahead}<small>人</small></strong></div><div><span>待ち時間の目安</span><strong>{wait}<small>分</small></strong></div></div><div className="estimate-row"><span>推定呼び出し時刻</span><strong>{formatDate(snapshot.estimatedStartAt)}</strong></div><div className="notice-card"><strong>現地を最優先にしてください</strong><p>表示している待ち時間は参考値です。実際の並び順や空き状況を現地で確認してください。</p></div>{snapshot.canSkipStart && <button className="secondary-button" onClick={onSkipStart} disabled={busy}>目の前で空きができた</button>}<button className="text-button danger" onClick={onCancel}>待ち列から退出</button></section>; }

function CalledScreen({ snapshot, onStart, onCancel, busy }: { snapshot: Snapshot; onStart: () => void; onCancel: () => void; busy: boolean }) { return <section className="screen called-screen"><div className="call-orbit"><span>あなたの</span><strong>番です</strong></div><p className="eyebrow">YOUR TURN</p><h1>5分以内に充電を開始</h1><p className="lead">空いたストールへ移動し、ケーブルを接続してください。</p><div className="countdown-card"><span>受付の残り時間</span><strong>{minutesRemaining(snapshot.callExpiresAt)}<small>分</small></strong><p>5分を過ぎると待ち列から自動で退出します。</p></div><div className="notice-card"><strong>現地の状況を優先</strong><p>実際に空いていない、順番が違う場合は現地案内に従ってください。</p></div><button className="primary-button" onClick={onStart} disabled={busy}>{busy ? "開始を記録しています…" : "充電を開始しました"}</button><button className="text-button danger" onClick={onCancel}>充電できないので退出</button></section>; }

function DurationScreen({ duration, setDuration, custom, setCustom, expected, onConfirm, busy }: { duration: number; setDuration: (value: number) => void; custom: string; setCustom: (value: string) => void; expected: Date | null; onConfirm: () => void; busy: boolean }) { return <section className="screen duration-screen"><div className="charging-icon">ϟ</div><p className="eyebrow">CHARGING STARTED</p><h1>何分充電しますか？</h1><p className="lead">次の人の待ち時間を計算するため、予定時間を入力してください。</p><div className="duration-options">{[20, 30, 40, 50].map((value) => <button type="button" key={value} className={!custom && duration === value ? "selected" : ""} onClick={() => { setDuration(value); setCustom(""); }}><strong>{value}</strong><small>分</small></button>)}</div><label className="field-label" htmlFor="duration">自由入力（5〜120分）</label><input id="duration" className="text-input" type="number" min={5} max={120} step={1} inputMode="numeric" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="30" /><div className="estimate-row"><span>終了予定</span><strong>{expected ? formatDate(expected.toISOString()) : "入力後に表示"}</strong></div><button className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? "確定しています…" : "この時間で確定"}</button></section>; }

function ChargingScreen({ snapshot, onComplete, onFinishCheck, busy }: { snapshot: Snapshot; onComplete: () => void; onFinishCheck: () => void; busy: boolean }) {
  const remainingSeconds = useCountdownSeconds(snapshot.expectedFinishAt);
  const scheduledSeconds = snapshot.chargingStartedAt && snapshot.expectedFinishAt
    ? Math.max(1, Math.round((new Date(snapshot.expectedFinishAt).getTime() - new Date(snapshot.chargingStartedAt).getTime()) / 1_000))
    : 1;
  const remainingPercent = Math.max(0, Math.min(100, (remainingSeconds / scheduledSeconds) * 100));
  const due = remainingSeconds <= 3 * 60;

  useEffect(() => {
    if (due && snapshot.canExtend) onFinishCheck();
  }, [due, onFinishCheck, snapshot.canExtend]);

  return <section className="screen charging-screen"><div className="charging-orbit"><span>ϟ</span></div><span className="live-label"><i />充電中</span><h1>充電しています</h1><p className="lead">終了予定 {formatDate(snapshot.expectedFinishAt)}</p><div className="remaining-time"><span>終了予定まで</span><strong aria-live="off">{formatCountdown(remainingSeconds)}</strong><small>分 : 秒</small><div aria-hidden="true"><i style={{ width: `${remainingPercent}%` }} /></div></div><div className="notice-card"><strong>現地を最優先にしてください</strong><p>終了予定と待ち時間は参考値です。施設の案内に従って、充電が終わったら移動してください。</p></div><button className="primary-button" onClick={due ? onFinishCheck : onComplete} disabled={busy}>{busy ? "処理しています…" : due ? "終了・延長を選ぶ" : "充電が終わりました"}</button>{due && <button className="text-button" onClick={onFinishCheck}>終了3分前の確認を開く</button>}</section>;
}

function FinishConfirmScreen({ snapshot, onComplete, onExtend, onBack, busy }: { snapshot: Snapshot; onComplete: () => void; onExtend: () => void; onBack: () => void; busy: boolean }) {
  const modalRef = useRef<HTMLElement>(null); useModalFocus(modalRef, onBack);
  return <div className="modal-backdrop"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="finish-title" tabIndex={-1}><button className="modal-close" onClick={onBack} aria-label="閉じる">×</button><p className="eyebrow">FINISH CHECK</p><h1 id="finish-title">あと{minutesRemaining(snapshot.expectedFinishAt)}分ほどです</h1><p className="lead">充電を終了しますか？次の方が待っている場合は、移動にご協力ください。</p><button className="primary-button" onClick={onComplete} disabled={busy}>充電を終了する</button><button className="secondary-button" onClick={onExtend} disabled={busy}>延長する</button></section></div>;
}

function ExtendScreen({ minutes, setMinutes, custom, setCustom, snapshot, onConfirm, onBack, busy }: { minutes: number; setMinutes: (value: number) => void; custom: string; setCustom: (value: string) => void; snapshot: Snapshot; onConfirm: () => void; onBack: () => void; busy: boolean }) {
  const modalRef = useRef<HTMLElement>(null); useModalFocus(modalRef, onBack);
  return <div className="modal-backdrop"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="extend-title" tabIndex={-1}><button className="modal-close" onClick={onBack} aria-label="閉じる">×</button><p className="eyebrow">EXTEND CHARGING</p><h1 id="extend-title">追加時間を選ぶ</h1><div className="duration-options">{[5, 10, 15, 30].map((value) => <button key={value} type="button" className={!custom && minutes === value ? "selected" : ""} onClick={() => { setMinutes(value); setCustom(""); }}><strong>{value}</strong><small>分</small></button>)}</div><label className="field-label" htmlFor="extension">自由入力（5〜120分）</label><input id="extension" className="text-input" type="number" min={5} max={120} step={1} inputMode="numeric" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="15" /><div className="estimate-row"><span>新しい終了予定</span><strong>{snapshot.expectedFinishAt ? formatDate(new Date(new Date(snapshot.expectedFinishAt).getTime() + (Number(custom) || minutes) * 60_000).toISOString()) : "—"}</strong></div><button className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? "延長しています…" : "延長を確定"}</button></section></div>;
}

function ResultScreen({ kind, autoCompleted, onHome }: { kind: "complete" | "expired" | "left"; autoCompleted?: boolean; onHome: () => void }) { const content = kind === "complete" ? { mark: "✓", eyebrow: autoCompleted ? "AUTO COMPLETED" : "CHARGE COMPLETE", title: autoCompleted ? "充電時間が終了しました" : "充電完了、おつかれさまでした", body: autoCompleted ? "終了予定から5分経過したため自動完了しました。現地の案内に従って移動してください。" : "待ち列から退出しました。次の方に順番をお知らせしています。" } : kind === "expired" ? { mark: "!", eyebrow: "CALL EXPIRED", title: "呼び出しが失効しました", body: "5分以内に開始できなかったため、待ち列を終了しました。" } : { mark: "✓", eyebrow: "QUEUE LEFT", title: "待ち列から退出しました", body: "現在の待ち列データを削除しました。次に使う時はニックネームを入力してください。" }; return <section className="screen result-screen"><div className={`result-mark ${kind}`}>{content.mark}</div><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p className="lead">{content.body}</p><button className="primary-button" onClick={onHome}>施設を探す</button></section>; }

function RecoveryScreen({ onSearch }: { onSearch: () => void }) { return <section className="screen result-screen"><div className="result-mark danger">?</div><p className="eyebrow">SESSION RECOVERY</p><h1>待ち列を復旧できません</h1><p className="lead">ブラウザの管理データが見つからないか、一致しません。他の利用者の待ち列情報は表示しません。</p><button className="primary-button" onClick={onSearch}>施設詳細へ</button></section>; }

function CancelDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const modalRef = useRef<HTMLElement>(null); useModalFocus(modalRef, onClose);
  return <div className="modal-backdrop"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title" tabIndex={-1}><button className="modal-close" onClick={onClose} aria-label="閉じる">×</button><p className="eyebrow">LEAVE QUEUE</p><h1 id="cancel-title">待ち列から退出しますか？</h1><p className="lead">退出すると順番は戻せません。</p><button className="primary-button danger-button" onClick={onConfirm} disabled={busy}>{busy ? "退出しています…" : "退出する"}</button><button className="secondary-button" onClick={onClose}>待機を続ける</button></section></div>;
}

function SkipStartDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const modalRef = useRef<HTMLElement>(null); useModalFocus(modalRef, onClose);
  return <div className="modal-backdrop"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="skip-start-title" tabIndex={-1}><button className="modal-close" onClick={onClose} aria-label="閉じる">×</button><p className="eyebrow">PHYSICAL VACANCY</p><h1 id="skip-start-title">周りに並んでいそうな車両はいませんか？</h1><p className="lead">現地の並びを確認し、問題なければ目の前の空きストールで充電を開始できます。開始後は後続の待ち時間を再計算します。</p><button className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? "開始を記録しています…" : "問題ないので充電を開始する"}</button><button className="secondary-button" onClick={onClose} disabled={busy}>待機を続ける</button></section></div>;
}
