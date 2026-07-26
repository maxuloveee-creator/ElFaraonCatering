import type { AdminOperationalState, RpcResult } from "../core/types";
import { normalizeAdminState } from "../core/adminState";

const requestedPublishHashStorageKey = "el-faraon-admin-requested-publish-hash";
const publishCooldownStorageKey = "el-faraon-admin-publish-cooldown-ends-at";
const defaultPublishCooldownSeconds = 60;

interface RequestedPublication {
  contentHash: string;
  expiresAt: number;
}

export function createAdminPublicationState(deployedContentHash: string) {
  let requestedPublication = readRequestedPublication();
  let publishCooldownEndsAt = readPublishCooldownEndsAt();

  function getRequestedPublishHash(): string {
    if (!requestedPublication || requestedPublication.expiresAt <= Date.now()) {
      clearRequestedPublication();
      return "";
    }

    return requestedPublication.contentHash;
  }

  function markCurrentPublicationRequested(state: AdminOperationalState | null): void {
    const contentHash = state?.publication.current_content_hash;

    if (!contentHash) {
      return;
    }

    const expiresAt = publishCooldownEndsAt > Date.now()
      ? publishCooldownEndsAt
      : Date.now() + (defaultPublishCooldownSeconds * 1000);

    requestedPublication = { contentHash, expiresAt };
    window.sessionStorage.setItem(
      requestedPublishHashStorageKey,
      JSON.stringify(requestedPublication),
    );
  }

  function rememberPublishCooldown(result: RpcResult): void {
    const seconds = result.cooldown_seconds_remaining
      ?? (result.message === "publish_queued" ? defaultPublishCooldownSeconds : 0);

    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0) {
      return;
    }

    publishCooldownEndsAt = Date.now() + (seconds * 1000);
    window.localStorage.setItem(publishCooldownStorageKey, String(publishCooldownEndsAt));
  }

  function getCooldownSecondsRemaining(): number {
    const millisecondsRemaining = publishCooldownEndsAt - Date.now();

    if (millisecondsRemaining <= 0) {
      publishCooldownEndsAt = 0;
      window.localStorage.removeItem(publishCooldownStorageKey);
      return 0;
    }

    return Math.ceil(millisecondsRemaining / 1000);
  }

  function reconcileState(state: AdminOperationalState): AdminOperationalState {
    const requestedPublishHash = getRequestedPublishHash();

    if (!requestedPublishHash) {
      return state.publication.publish_requested
        ? normalizeAdminState(state, deployedContentHash, "")
        : state;
    }

    const currentContentHash = state.publication.current_content_hash;
    const activeDeployedContentHash = state.publication.deployed_content_hash;

    if (requestedPublishHash === currentContentHash && requestedPublishHash !== activeDeployedContentHash) {
      return state;
    }

    clearRequestedPublication();
    return normalizeAdminState(state, deployedContentHash, "");
  }

  function reset(): void {
    clearRequestedPublication();
    publishCooldownEndsAt = 0;
    window.localStorage.removeItem(publishCooldownStorageKey);
  }

  function clearRequestedPublication(): void {
    requestedPublication = null;
    window.sessionStorage.removeItem(requestedPublishHashStorageKey);
  }

  return {
    getCooldownSecondsRemaining,
    getRequestedPublishHash,
    markCurrentPublicationRequested,
    reconcileState,
    rememberPublishCooldown,
    reset,
  };
}

function readRequestedPublication(): RequestedPublication | null {
  const value = window.sessionStorage.getItem(requestedPublishHashStorageKey);

  if (!value) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);

    if (
      parsedValue
      && typeof parsedValue === "object"
      && typeof (parsedValue as RequestedPublication).contentHash === "string"
      && /^[a-f0-9]{32}$/.test((parsedValue as RequestedPublication).contentHash)
      && Number.isSafeInteger((parsedValue as RequestedPublication).expiresAt)
      && (parsedValue as RequestedPublication).expiresAt > Date.now()
    ) {
      return parsedValue as RequestedPublication;
    }
  } catch {
    // Legacy values stored only the content hash and must not keep the UI latched.
  }

  window.sessionStorage.removeItem(requestedPublishHashStorageKey);
  return null;
}

function readPublishCooldownEndsAt(): number {
  const value = Number(window.localStorage.getItem(publishCooldownStorageKey));
  return Number.isSafeInteger(value) && value > Date.now() ? value : 0;
}
