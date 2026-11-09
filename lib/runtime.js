import { KnowledgeStore } from './store.js';
import { peerOf, lastQuestion, knowledgeContext } from './context.js';
export function searchForSession(settings, context, query) {
  const c = settings.read(), peer = peerOf(context);
  if (!c.enabled || !peer || !c.allowedPeers.includes(peer)) return [];
  if (typeof query !== 'string' || !query.trim() || query.length > 2400) return [];
  return new KnowledgeStore(c.dataDir).search(peer, query, { limit: 5, reviewAfterDays: c.reviewAfterDays });
}
export function makePreStep(settings, createUserMessage, onError = () => {}) {
  return async (args, next) => {
    const decision = next ? await next() : { kind: 'enter', messages: args.messages || [] };
    if (decision.kind === 'reject') return decision;
    try {
      // Replace old knowledge snapshots so retired/corrected entries stop resurfacing.
      const messages = (decision.messages || []).filter(x => x.source?.kind !== 'fallout76-context');
      const query = lastQuestion(messages);
      const reference = knowledgeContext(searchForSession(settings, args, query), settings.read().contextChars);
      return { ...decision, messages: reference ? [...messages, createUserMessage({ content: [{ type: 'text', text: reference }], source: { kind: 'fallout76-context' } })] : messages };
    } catch (e) { onError(e); return { ...decision, messages: (decision.messages || []).filter(x => x.source?.kind !== 'fallout76-context') }; }
  };
}
