import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ensureStarter } from './starter.js';
import { Settings } from './settings.js';
import { Learner, createExtractor } from './learner.js';
import { createHandler, ROUTE } from './http.js';
import { makePreStep, searchForSession } from './runtime.js';
export const name = 'dsh-fallout76-knowledge';
export const inject = ['tools', 'llm'];
export function apply(ctx) {
  const settings = new Settings(), learner = new Learner(settings, createExtractor(ctx));
  const logger = ctx.logger?.(name) || console;
  const cleanup = [];
  cleanup.push(ctx.tools.register(defineTool({
    name: 'search_fallout76_knowledge',
    description: '查询当前辐射76群积累的游戏经验、配装和机制。只返回当前会话的公共基础资料和讨论；reference是带来源的整理资料，不等于官方实测；experience是玩家经验、disputed是有争议、verified是管理员核实。注意版本和时效，不能冒充官方结论；没结果就明确尚未收录。',
    parameters: { query: { type: 'string', required: true, description: '游戏主题、武器名、任务名或黑话' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, context) { return { entries: searchForSession(settings, context, args.query) }; }
  })));
  cleanup.push(ctx.on('agent/pre-step', makePreStep(settings, createUserMessage, e => logger.warn?.(e.message))));
  ctx.inject(['webServer', 'connection'], scope => {
    const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE, handler: createHandler({ settings, learner, authenticate: req => scope.connection.requestRejection(req) }) });
    scope.on('dispose', dispose);
  });
  const tick = async () => { try { ensureStarter(settings.read()); await learner.tick(); } catch(e) { learner.lastError = e.message; } };
  const timer = setInterval(tick, 30000); timer.unref?.();
  const first = setTimeout(tick, 1500); first.unref?.();
  ctx.on('dispose', () => { clearInterval(timer); clearTimeout(first); learner.stop(); for (const fn of cleanup) if (typeof fn === 'function') fn(); });
}
