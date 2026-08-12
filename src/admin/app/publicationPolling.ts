import type { PublicationState } from "../core/types";

export const publicationPollingDelayedNoticeAttempt = 21;
export const publicationPollingFastDelayMs = 5_000;
export const publicationPollingSlowDelayMs = 15_000;
export const publicationPollingRecoveryDelayMs = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;

interface AdminPublicationPollerContext {
  loadPublicationState(): Promise<PublicationState>;
  isVisible(): boolean;
  onError(error: unknown): void;
  onDelayed(): void;
  now?(): number;
  setTimer?(callback: () => void, delayMs: number): TimerHandle;
  clearTimer?(timer: TimerHandle): void;
}

export function createAdminPublicationPoller(context: AdminPublicationPollerContext) {
  const setTimer = context.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = context.clearTimer ?? ((timer) => clearTimeout(timer));
  let active = false;
  let activeRequestKey = "";
  let activeExpiresAt: string | null = null;
  let attempts = 0;
  let delayedNoticeSent = false;
  let generation = 0;
  let timer: TimerHandle | null = null;
  let inFlight = false;
  let resumeAfterFlight = false;

  function start(publication: PublicationState, pollImmediately = true): void {
    if (publication.phase !== "publishing") {
      stop();
      return;
    }

    const requestKey = publication.requested_at ?? "";

    if (active && requestKey === activeRequestKey) {
      return;
    }

    generation += 1;
    active = true;
    activeRequestKey = requestKey;
    activeExpiresAt = publication.expires_at;
    attempts = 0;
    delayedNoticeSent = false;
    resumeAfterFlight = false;
    clearScheduledPoll();

    if (pollImmediately) {
      resume();
    } else if (context.isVisible()) {
      timer = setTimer(() => {
        timer = null;
        void poll(generation);
      }, publicationPollingFastDelayMs);
    }
  }

  function pause(): void {
    clearScheduledPoll();
  }

  function resume(): void {
    if (!active || !context.isVisible()) {
      return;
    }

    clearScheduledPoll();

    if (inFlight) {
      resumeAfterFlight = true;
      return;
    }

    void poll(generation);
  }

  function stop(): void {
    generation += 1;
    active = false;
    activeRequestKey = "";
    activeExpiresAt = null;
    attempts = 0;
    delayedNoticeSent = false;
    resumeAfterFlight = false;
    clearScheduledPoll();
  }

  async function poll(pollGeneration: number): Promise<void> {
    if (!active || pollGeneration !== generation || !context.isVisible()) {
      return;
    }

    inFlight = true;
    attempts += 1;
    let publication: PublicationState | null = null;

    try {
      publication = await context.loadPublicationState();
    } catch (error) {
      if (pollGeneration === generation && active) {
        context.onError(error);
      }
    } finally {
      inFlight = false;
    }

    if (pollGeneration !== generation) {
      if (active) {
        resumeAfterFlight = false;
        resume();
      }
      return;
    }

    if (!active) {
      return;
    }

    if (publication?.phase && publication.phase !== "publishing") {
      stop();
      return;
    }

    const nextRequestKey = publication?.requested_at ?? activeRequestKey;

    if (nextRequestKey !== activeRequestKey) {
      activeRequestKey = nextRequestKey;
      activeExpiresAt = publication?.expires_at ?? null;
      attempts = 1;
      delayedNoticeSent = false;
    } else if (publication) {
      activeExpiresAt = publication.expires_at;
    }

    if (resumeAfterFlight) {
      resumeAfterFlight = false;
      resume();
      return;
    }

    if (attempts >= publicationPollingDelayedNoticeAttempt && !delayedNoticeSent) {
      delayedNoticeSent = true;
      context.onDelayed();
    }

    const delayMs = getNextPublicationPollingDelay(
      attempts,
      activeExpiresAt,
      context.now?.() ?? Date.now(),
    );

    if (!context.isVisible()) {
      return;
    }

    timer = setTimer(() => {
      timer = null;
      void poll(generation);
    }, delayMs);
  }

  function clearScheduledPoll(): void {
    if (timer === null) {
      return;
    }

    clearTimer(timer);
    timer = null;
  }

  return {
    pause,
    resume,
    start,
    stop,
  };
}

export function getNextPublicationPollingDelay(
  attemptsCompleted: number,
  expiresAt: string | null = null,
  nowMs = Date.now(),
): number {
  let delayMs: number;

  if (attemptsCompleted < 13) {
    delayMs = publicationPollingFastDelayMs;
  } else if (attemptsCompleted < publicationPollingDelayedNoticeAttempt) {
    delayMs = publicationPollingSlowDelayMs;
  } else {
    delayMs = publicationPollingRecoveryDelayMs;
  }

  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  if (!Number.isFinite(expiresAtMs)) {
    return delayMs;
  }

  if (expiresAtMs <= nowMs) {
    return Math.min(delayMs, publicationPollingFastDelayMs);
  }

  return Math.min(delayMs, Math.max(1_000, expiresAtMs - nowMs));
}
