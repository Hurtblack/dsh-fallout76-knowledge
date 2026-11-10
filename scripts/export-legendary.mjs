import { starterCatalog } from '../lib/starter.js';

const { revision, entries } = starterCatalog();
const sections = [
  ['武器传奇改装件', entry => entry.legendaryMod && entry.category === 'weapon'],
  ['护甲与动力装甲传奇改装件', entry => entry.legendaryMod && entry.category === 'armor'],
  ['传奇模块奖励与兑换', entry => entry.id.startsWith('legendary-module-')],
];
const blocks = [
  '# 辐射76传奇改装件与传奇模块',
  `资料修订 ${revision}。用户供表未注明整体游戏版本。已核对的补丁或游戏数据与原表分开列出。奖励数量空白为未提供，原表明确填写的 0 单独保留。`,
];
for (const [heading, includes] of sections) {
  blocks.push(`## ${heading}`);
  for (const entry of entries.filter(includes)) {
    const sources = entry.sources.map(source =>
      source.url ? `[${source.title}](${source.url})` : source.title);
    blocks.push(`### ${entry.title}`, entry.body, `资料来源 ${sources.join('、')}。`);
  }
}
process.stdout.write(blocks.join('\n\n') + '\n');
