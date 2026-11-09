window.__ModuleLoader__.load({
  id: 'dsh-fallout76-knowledge',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const API = '/plugins/dsh-fallout76-knowledge/api';
    async function api(body) {
      const response = await fetch(API, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      const data = await response.json();
      if (!data.ok) throw Error(data.error || '操作失败');
      return data;
    }
    const inputStyle = { padding: 8, border: '1px solid #8886', borderRadius: 6, background: 'transparent', color: 'inherit', width: '100%' };
    const buttonStyle = { padding: '7px 12px', margin: '6px 8px 6px 0', border: '1px solid #8886', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: 'pointer' };
    const labels = { experience: '玩家经验', disputed: '存在争议', verified: '管理员已核实', retired: '已停用' };
    function Entry({ entry, save, disabled }) {
      const [body, setBody] = React.useState(entry.body), [status, setStatus] = React.useState(entry.status), [note, setNote] = React.useState('');
      return h('article', { style: { border: '1px solid #8885', borderRadius: 10, padding: 14, marginTop: 12 } },
        h('strong', null, entry.title),
        h('p', null, `${labels[entry.status]} · ${entry.platform} · ${entry.version}${entry.needsReview ? ' · 较久未核实' : ''}`),
        h('textarea', { value: body, onChange: e => setBody(e.target.value), rows: 3, style: inputStyle, 'aria-label': '词条内容' }),
        h('p', null, '来源：', ...entry.evidence.slice(-4).map((x, i) => h('span', { key: i, style: { display: 'block', whiteSpace: 'pre-wrap' } }, `${new Date(x.time).toLocaleString()} · 消息 ${x.messageId}：「${x.quote}」`))),
        h('select', { value: status, onChange: e => setStatus(e.target.value), 'aria-label': '知识状态', style: inputStyle }, ...Object.entries(labels).map(([key, name]) => h('option', { value: key, key }, name))),
        h('input', { value: note, onChange: e => setNote(e.target.value), placeholder: '修改理由／核实来源（必填）', style: { ...inputStyle, marginTop: 8 } }),
        h('button', { disabled: disabled || !note.trim(), style: buttonStyle, onClick: () => save({ action: 'review', id: entry.id, status, body, note }) }, '保存修改'),
        entry.reviewNote && h('small', null, `上次说明：${entry.reviewNote}`),
        entry.revisions.length > 0 && h('details', null, h('summary', null, `修改记录（${entry.revisions.length}）`), ...entry.revisions.slice().reverse().map((x, i) => h('p', { key: i }, `${new Date(x.at).toLocaleString()} · ${labels[x.status]} · ${x.reason}\n${x.body}`)))
      );
    }
    function Card() {
      const [data, setData] = React.useState(null), [config, setConfig] = React.useState(null), [peer, setPeer] = React.useState('');
      const [query, setQuery] = React.useState(''), [entries, setEntries] = React.useState([]), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false), [minutes, setMinutes] = React.useState(60);
      async function refresh() { const d = await api(); setData(d); setConfig(d.config); setPeer(current => d.config.allowedPeers.includes(current) ? current : (d.config.allowedPeers[0] || '')); return d; }
      React.useEffect(() => { refresh().catch(e => setMessage(e.message)); }, []);
      async function search() { const r = await api({ action: 'search', peer, query, includeRetired: true }); setEntries(r.result); }
      async function run(fn) { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
      async function save(body) { await run(async () => { await api(body); await refresh(); await search(); setMessage('已保存'); }); }
      if (!config) return h('section', { style: { padding: 24 } }, h('h2', null, '辐射76知识库'), h('p', null, message || '正在读取…'));
      const field = (key, label, type = 'text') => h('label', { style: { display: 'block', marginTop: 10 } }, label, h('input', { type, value: config[key], onChange: e => setConfig({ ...config, [key]: type === 'number' ? Number(e.target.value) : e.target.value }), style: inputStyle }));
      return h('section', { style: { padding: 24, maxWidth: 960 } },
        h('h2', null, '辐射76知识库'),
        h('p', null, '从群友讨论中静默整理配装、机制和攻略，聊天时按需参考。记录过程不会发送QQ消息。'),
        h('p', null, `${data.status.count} 条知识 · 今日整理 ${data.status.budget.used} 次（UTC ${data.status.budget.day || '尚未开始'}） · ${data.status.busy ? '正在整理' : '空闲'} · ${data.status.sourceExists ? '消息库已找到' : '等待NapCat消息库'}`),
        (message || data.status.error) && h('p', { role: 'status', style: { whiteSpace: 'pre-wrap' } }, message || data.status.error),
        h('details', null, h('summary', null, '学习设置'),
          ...[['enabled', '启用知识库'], ['autoLearn', '自动整理聊天（使用所选模型的额度）']].map(([key, label]) => h('label', { key, style: { display: 'block', marginTop: 12 } }, h('input', { type: 'checkbox', checked: config[key], onChange: e => setConfig({ ...config, [key]: e.target.checked }) }), label)),
          h('label', { style: { display: 'block', marginTop: 10 } }, '允许学习的会话，每行一个；群：group_群号，私聊：user_QQ号', h('textarea', { rows: 3, value: config.allowedPeers.join('\n'), onChange: e => setConfig({ ...config, allowedPeers: e.target.value.split('\n') }), style: inputStyle })),
          field('dataDir', '知识库目录（绝对路径，可放FP80；换路径不自动搬迁旧库）'), field('napcatDb', 'NapCat消息数据库路径'),
          field('provider', '模型提供方'), field('model', '模型名称'), field('intervalSeconds', '整理间隔下限（秒）', 'number'), field('dailyBatches', '每日最多整理次数', 'number'),
          h('button', { style: buttonStyle, disabled: busy, onClick: () => run(async () => { await api({ action: 'configure', config: { ...config, allowedPeers: config.allowedPeers.map(x => x.trim()).filter(Boolean) } }); await refresh(); setMessage('设置已保存'); }) }, '保存设置'),
          h('p', null, '首次启用从当前消息开始。群之间、私聊与群之间不混用知识。资料只保存经验摘要与必要原话，不复制整个聊天。')),
        h('label', { style: { display: 'block', marginTop: 16 } }, '当前会话', h('select', { value: peer, onChange: e => { setPeer(e.target.value); setEntries([]); }, style: inputStyle }, ...[...new Set([peer, ...data.config.allowedPeers])].map(p => h('option', { value: p, key: p }, p || '请先在学习设置添加群号')))),
        h('input', { value: query, onChange: e => setQuery(e.target.value), placeholder: '搜索武器、任务、配装；留空列出最近200条', style: { ...inputStyle, marginTop: 10 } }),
        h('button', { disabled: busy, style: buttonStyle, onClick: () => run(search) }, '搜索／刷新词条'),
        h('button', { disabled: busy, style: buttonStyle, onClick: () => run(async () => { const r = await api({ action: 'export' }); const url = URL.createObjectURL(new Blob([JSON.stringify(r.result, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'fallout76-knowledge-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }) }, '导出知识'),
        h('details', null, h('summary', null, '手动整理与游标恢复'),
          h('p', null, '可整理最近1至10080分钟，单次最多读取设置中的批量条数；不会改变自动学习进度。'),
          h('input', { type: 'number', min: 1, max: 10080, value: minutes, onChange: e => setMinutes(Number(e.target.value)), 'aria-label': '回看分钟数', style: inputStyle }),
          h('button', { disabled: busy, style: buttonStyle, onClick: () => run(async () => { const r = await api({ action: 'learn', peer, minutes }); await refresh(); await search(); setMessage(JSON.stringify(r.result)); }) }, '整理最近聊天'),
          h('button', { disabled: busy, style: buttonStyle, onClick: () => { if (window.confirm('从当前最新消息重新开始学习？尚未整理的旧消息会跳过，已有知识保留。')) run(async () => { await api({ action: 'reset-cursor', peer }); await refresh(); setMessage('已从最新消息开始'); }); } }, '从最新消息重新开始')),
        ...entries.map(entry => h(Entry, { entry, key: `${entry.id}-${entry.updatedAt}`, save, disabled: busy })),
        h('p', { style: { opacity: .65 } }, '玩家经验可能过时或有误；有争议的条目保留各方说法，管理员可以核实、更正或停用。')
      );
    }
    return { name: 'dsh-fallout76-knowledge', inject: ['slots'], apply(ctx) {
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register({ name: 'settings.section', id: 'fallout76-knowledge', order: 56, label: () => '辐射76知识库' }, Card);
      });
    } };
  }
});
