import type { ServerMessage } from '../../../../core/src/messages.js';
import type { MessageContext } from './messageContext.js';
import { hooksSubjectKey } from './messageContext.js';

/** Settings, hooks consent, connections and quota family. Returns true if `msg.type`
 *  matched one of its variants. */
export function handleSettingsMessage(msg: ServerMessage, ctx: MessageContext): boolean {
  if (msg.type === 'settingsLoaded') {
    if (typeof msg.hooksEnabled === 'boolean') {
      ctx.setHooksEnabled(msg.hooksEnabled);
    }
    if (typeof msg.hooksInfoShown === 'boolean') {
      ctx.setHooksInfoShown(msg.hooksInfoShown);
    }
    if (typeof msg.lastSeenVersion === 'string') {
      ctx.setLastSeenVersion(msg.lastSeenVersion);
    }
    if (typeof msg.extensionVersion === 'string') {
      ctx.setExtensionVersion(msg.extensionVersion);
    }
    return true;
  } else if (msg.type === 'hooksStatus') {
    if (
      typeof msg.installed === 'boolean' &&
      typeof msg.providerId === 'string' &&
      typeof msg.subjectId === 'string'
    ) {
      const providerId = msg.providerId;
      const subjectId = msg.subjectId;
      const installed = msg.installed;
      const key = hooksSubjectKey(providerId, subjectId);
      ctx.setHooksInstalled((m) => ({ ...m, [key]: installed }));
      ctx.setHooksStatusSeq((m) => ({ ...m, [key]: (m[key] ?? 0) + 1 }));
      if (installed) {
        // Moot once THIS (provider, subject) pair is installed — the hooks tooltip or another tab granted
        // consent while the dialog was open. Drop it from the queue (head or queued) rather than let a stale
        // approval re-install; a DIFFERENT pair's status is not about this ask.
        ctx.setConsentQueue((q) =>
          q.filter((r) => r.providerId !== providerId || r.subjectId !== subjectId),
        );
      }
    }
    return true;
  } else if (msg.type === 'hooksConsentRequest') {
    if (
      typeof msg.providerId === 'string' &&
      typeof msg.subjectId === 'string' &&
      typeof msg.headline === 'string' &&
      typeof msg.disclosure === 'string' &&
      typeof msg.actionLabel === 'string'
    ) {
      const request = msg;
      ctx.setConsentQueue((q) => {
        const i = q.findIndex(
          (r) => r.providerId === request.providerId && r.subjectId === request.subjectId,
        );
        if (i === -1) return [...q, request];
        const next = q.slice();
        next[i] = request; // a re-ask carries the freshest copy
        return next;
      });
    }
    return true;
  } else if (msg.type === 'connectionsLoaded') {
    if (Array.isArray(msg.connections)) {
      ctx.setConnections(msg.connections);
    }
    return true;
  } else if (msg.type === 'connectionAddResult') {
    if (typeof msg.requestId === 'string') {
      const resolve = ctx.pendingConnectionAddsRef.current.get(msg.requestId);
      if (resolve) {
        ctx.pendingConnectionAddsRef.current.delete(msg.requestId);
        resolve(typeof msg.error === 'string' ? msg.error : undefined);
      }
    }
    return true;
  } else if (msg.type === 'quotaUpdate') {
    if (Array.isArray(msg.meters)) {
      ctx.setQuotaMeters(msg.meters);
    }
    return true;
  }
  return false;
}
