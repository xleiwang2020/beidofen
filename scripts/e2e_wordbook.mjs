// 端到端验证：用 CDP 驱动 headless Chrome 真实操作页面
// 覆盖：五线格听音拼写、看释义猜词拼写、单词本闸门（自动弹窗 / 过关才能继续 / 答错排队尾 /
//       家长跳过 / 通关移出单词本）、真实键盘输入链路、运行期 JS 报错。
//
// 运行方式（本机 macOS，无需任何依赖）：
//   方式一（推荐）： ./scripts/dev.sh          # 起服务 + 起 Chrome + 跑测试
//   方式二（手动）：
//     1) 起静态服务器：  python3 -m http.server 8765（建议 --bind 0.0.0.0）
//     2) 起 headless Chrome：
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//          --disable-gpu --mute-audio --autoplay-policy=no-user-gesture-required \
//          --remote-debugging-port=9333 --user-data-dir=/tmp/ket-cdp-profile about:blank &
//     3) 跑测试：        node scripts/e2e_wordbook.mjs
//      （可用 CDP_PORT / APP_URL / APP_PORT 覆盖默认值；不指定 APP_URL 时脚本会自动
//        探测 127.0.0.1 与 localhost 哪个能连通，兼容 IPv4 / IPv6 两种绑定）
//
// 退出码：全部通过为 0，存在失败为 1。
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.CDP_PORT || 9333);
const APP_PORT = Number(process.env.APP_PORT || 8765);

/** 自动挑一个连得上的应用地址（python http.server 在某些系统上只监听 IPv6） */
async function resolveAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const candidates = [
    `http://127.0.0.1:${APP_PORT}/index.html`,
    `http://localhost:${APP_PORT}/index.html`
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (res.ok) return url;
    } catch (e) { /* 试下一个 */ }
  }
  console.log(`提示：没能探测到本地服务，将使用 ${candidates[0]}（请确认已执行 ./scripts/dev.sh start）`);
  return candidates[0];
}

const APP = await resolveAppUrl();

let msgId = 0;
const pending = new Map();
const pageErrors = [];
let ws = null;

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
}

function send(method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function ev(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(function(){ ${expr} })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('页面内异常: ' + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
}

async function waitFor(expr, timeout = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v = false;
    try { v = await ev(expr); } catch (e) { v = false; }
    if (v) return true;
    await sleep(120);
  }
  console.log('   waitFor 超时: ' + (label || expr));
  return false;
}

// 真实键盘输入（CDP Input 域），用于验证隐藏 input 的键盘链路
async function typeChar(ch) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  await sleep(30);
}

async function pressBackspace() {
  const p = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, p));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, p));
  await sleep(60);
}

async function pressEnter() {
  const p = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, p));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: '\r' }, p));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, p));
  await sleep(120);
}

async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(300);
  return waitFor(`return !document.getElementById('app').hasAttribute('hidden');`, 8000, 'app 启动');
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('没有找到浏览器页面目标');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.method + ': ' + JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push('例外: ' + ((d.exception && d.exception.description) || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const txt = (msg.params.args || []).map(a => a.value || a.description || a.type).join(' ');
      pageErrors.push('console.error: ' + txt);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  // ------------------------------------------------------------ T1 启动
  await goto(APP);
  await ev(`localStorage.clear(); return true;`);   // 从干净状态开始
  await goto(APP);
  const boot = await ev(`
    return {
      appVisible: !document.getElementById('app').hasAttribute('hidden'),
      todayVisible: !document.getElementById('screen-today').hasAttribute('hidden'),
      tabs: document.querySelectorAll('#tabbar .tab').length,
      wordbookTab: !!document.querySelector('#tabbar [data-go="wordbook"]'),
      gateHidden: document.getElementById('gate').hasAttribute('hidden'),
      words: (window.KET_WORDS && window.KET_WORDS.words || []).length,
      hasGrid: typeof window.RuledGrid === 'function',
      hasNormalize: typeof window.normalizeSpelling === 'function',
      hasGateClass: typeof window.WordbookGate === 'function',
      practiceBtns: ['btn-practice-dictation','btn-practice-definition','btn-practice-wordbook']
        .map(id => !!document.getElementById(id))
    };
  `);
  check('T1 应用启动并显示今日页', boot.appVisible && boot.todayVisible);
  check('T1 底部出现「单词本」标签页', boot.tabs === 5 && boot.wordbookTab, `${boot.tabs} 个标签`);
  check('T1 词库加载正常', boot.words > 1000, `${boot.words} 词`);
  check('T1 五线格 / 闸门模块已加载', boot.hasGrid && boot.hasNormalize && boot.hasGateClass);
  check('T1 三个专项练习入口存在', boot.practiceBtns.every(Boolean));
  check('T1 单词本为空时不弹闸门', boot.gateHidden);

  // ------------------------------------------- T2 听音拼写（五线格）
  await ev(`document.getElementById('btn-practice-dictation').click(); return true;`);
  const t2ready = await waitFor(`
    return !document.getElementById('screen-study').hasAttribute('hidden')
      && !!document.querySelector('#grid-mount .ruled-grid');
  `, 6000, '听音拼写题目渲染');
  const t2 = t2ready ? await ev(`
    return {
      label: (document.querySelector('.q-label')||{}).textContent || '',
      glines: document.querySelectorAll('#grid-mount .gline').length,
      baseline: document.querySelectorAll('#grid-mount .gline.baseline').length,
      cells: document.querySelectorAll('#grid-mount .cell').length,
      hint: (document.querySelector('.q-pos')||{}).textContent || '',
      gradeHint: (document.querySelector('.grid-hint')||{}).textContent || '',
      hasInput: !!document.querySelector('#grid-mount .grid-input'),
      hasSubmit: !!document.getElementById('btn-submit-type'),
      promptZh: (document.querySelector('.q-zh')||{}).textContent || ''
    };
  `) : { label: '未渲染', glines: 0, baseline: 0, cells: 0, hint: '', gradeHint: '', hasInput: false, hasSubmit: false, promptZh: '' };
  const t2letters = Number((t2.gradeHint.match(/(\d+)\s*格/) || [0, 0])[1]);
  check('T2 听音拼写题进入五线格', t2ready && t2.cells > 0, t2.label);
  check('T2 五线格画出 5 条线（第 4 条为基准线）', t2.glines === 5 && t2.baseline === 1, `${t2.glines} 线`);
  check('T2 格子数量 = 单词字母数', t2letters > 0 && t2.cells === t2letters, `${t2.cells} 格 / ${t2letters} 字母`);
  check('T2 只给读音、不泄露拼写', /听发音/.test(t2.hint) && t2.promptZh === '', t2.hint.trim());
  check('T2 有隐藏输入框与确认按钮', t2.hasInput && t2.hasSubmit);

  // 故意答错：验证红色反馈、锁定、揭示答案
  const wrongInfo = await ev(`
    const inp = document.querySelector('#grid-mount .grid-input');
    inp.value = 'z'.repeat(document.querySelectorAll('#grid-mount .cell').length);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const typedGhostEmpty = document.querySelectorAll('#grid-mount .cell .glyph').length;
    document.getElementById('btn-submit-type').click();
    const fb = document.querySelector('#card-feedback');
    return {
      fbClass: fb.className,
      fbText: (fb.querySelector('.fb-text b')||{}).textContent || '',
      fbSub: (fb.querySelector('.fb-sub')||{}).textContent || '',
      inputDisabled: inp.disabled,
      glyphs: typedGhostEmpty,
      hasNext: !!fb.querySelector('#btn-next'),
      hasStar: !!fb.querySelector('#fb-star'),
      starLbl: (fb.querySelector('#fb-star .star-lbl')||{}).textContent || '',
      badCells: document.querySelectorAll('#grid-mount .cell.bad').length
    };
  `);
  check('T2 答错显示错误反馈', /no/.test(wrongInfo.fbClass), wrongInfo.fbClass);
  check('T2 答错后给出正确拼写', /记一下/.test(wrongInfo.fbText), wrongInfo.fbText.trim());
  check('T2 答错后五线格逐格标红并锁定', wrongInfo.badCells > 0 && wrongInfo.inputDisabled, `${wrongInfo.badCells} 格标红`);
  check('T2 反馈区提供「收进单词本」按钮', wrongInfo.hasNext && wrongInfo.hasStar, wrongInfo.starLbl);

  // 点「收进单词本」→ 应写入 localStorage 并出现角标
  const starRes = await ev(`
    const before = Object.keys(JSON.parse(localStorage.getItem('ket_planet_v1') || '{}').wordbook || {}).length;
    document.querySelector('#fb-star').click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const badge = document.getElementById('tab-wb-badge');
    const ids = Object.keys(saved.wordbook || {});
    return {
      before: before,
      count: ids.length,
      badgeHidden: badge.hasAttribute('hidden'),
      badgeText: badge.textContent,
      lbl: (document.querySelector('#fb-star .star-lbl')||{}).textContent || '',
      source: saved.wordbook[ids[ids.length - 1]] && saved.wordbook[ids[ids.length - 1]].source
    };
  `);
  check('T2 单词可收进单词本并持久化', starRes.count === starRes.before + 1, `${starRes.before} → ${starRes.count} 词, source=${starRes.source}`);
  check('T2 单词本角标显示数量', !starRes.badgeHidden && starRes.badgeText === String(starRes.count) && starRes.lbl === '已在单词本', starRes.badgeText);

  // 取消收藏（用反馈按钮再点一次）
  const unstar = await ev(`
    document.querySelector('#fb-star').click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    return { count: Object.keys(saved.wordbook || {}).length, lbl: document.querySelector('#fb-star .star-lbl').textContent };
  `);
  check('T2 再次点击移出单词本', unstar.count === starRes.before && unstar.lbl === '收进单词本', unstar.lbl);


  // ------------------------------------- T3 看释义猜词（五线格，答对）
  await goto(APP);
  await ev(`document.getElementById('btn-practice-definition').click(); return true;`);
  const t3ready = await waitFor(`
    return !document.getElementById('screen-study').hasAttribute('hidden')
      && !!document.querySelector('#grid-mount .ruled-grid')
      && !!(document.querySelector('.q-zh')||{}).textContent;
  `, 6000, '看释义猜词题目渲染');

  const t3 = t3ready ? await ev(`
    const zh = (document.querySelector('.q-zh')||{}).textContent || '';
    const cells = document.querySelectorAll('#grid-mount .cell').length;
    const cands = (window.KET_WORDS.words || []).filter(w => w.zh === zh && w.word.length === cells);
    return {
      label: (document.querySelector('.q-label')||{}).textContent || '',
      zh: zh,
      cells: cells,
      pos: (document.querySelector('.q-pos')||{}).textContent || '',
      sentence: (document.querySelector('.q-sentence')||{}).textContent || '',
      cands: cands.map(w => w.word),
      promptZhCount: document.querySelectorAll('.q-prompt .q-zh').length
    };
  `) : { label: '', zh: '', cells: 0, pos: '', sentence: '', cands: [], promptZhCount: 0 };

  check('T3 看释义猜词进入五线格', t3ready, t3.label);
  check('T3 给出中文释义作为提示', !!t3.zh && t3.promptZhCount === 1, t3.zh);
  check('T3 选项式释义不作为唯一依据（可定位答案）', t3.cands.length > 0, '候选: ' + t3.cands.join('/') || '(空)');

  // 用候选词作答，若首个候选不对则重新加载换下一题
  let t3ok = false, t3detail = '';
  for (let attempt = 0; attempt < 3 && !t3ok; attempt++) {
    if (attempt > 0) {
      await goto(APP);
      await ev(`document.getElementById('btn-practice-definition').click(); return true;`);
      await waitFor(`return !!document.querySelector('#grid-mount .ruled-grid');`, 6000, '重载题目');
    }
    const cands = await ev(`
      const zh = (document.querySelector('.q-zh')||{}).textContent || '';
      const cells = document.querySelectorAll('#grid-mount .cell').length;
      return (window.KET_WORDS.words || []).filter(w => w.zh === zh && w.word.length === cells).map(w => w.word);
    `);
    if (!cands.length) continue;
    const typed = await ev(`
      const inp = document.querySelector('#grid-mount .grid-input');
      inp.value = ${JSON.stringify(cands[0])};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const glyphs = Array.from(document.querySelectorAll('#grid-mount .cell .glyph')).map(g => g.textContent).join('');
      document.getElementById('btn-submit-type').click();
      const fb = document.querySelector('#card-feedback');
      return {
        glyphs: glyphs,
        fbClass: fb.className,
        fbText: (fb.querySelector('.fb-text b')||{}).textContent || '',
        okCells: document.querySelectorAll('#grid-mount .cell.ok').length,
        saved: Object.keys((JSON.parse(localStorage.getItem('ket_planet_v1') || '{}').words) || {}).length
      };
    `);
    t3detail = `输入 ${cands[0]} → ${typed.fbClass}`;
    if (typed.glyphs === cands[0]) {
      check('T3 输入字母逐个落在五线格内', true, typed.glyphs);
    }
    if (/ok/.test(typed.fbClass)) {
      t3ok = true;
      check('T3 拼写正确判定为「答对」', typed.okCells === typed.glyphs.length, `${typed.okCells} 格全绿`);
      check('T3 答对写入 SRS 进度', typed.saved > 0, `${typed.saved} 条记录`);
    }
  }
  check('T3 拼写正确路径整体通过', t3ok, t3detail);


  // --------------------------------------- T4 单词本页面 + 收藏单词
  await goto(APP);
  await ev(`
    localStorage.removeItem('ket_planet_v1');
    return true;
  `);
  await goto(APP);

  await ev(`document.querySelector('#tabbar [data-go="words"]').click(); return true;`);
  await waitFor(`return document.querySelectorAll('#word-list .word-row').length > 0;`, 6000, '单词库渲染');

  const t4 = await ev(`
    const star = document.querySelector('#word-list .star-btn');
    const id = star.dataset.star;
    star.click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const entry = saved.wordbook[id];
    const rowText = star.closest('.word-row').querySelector('.w-en').textContent;
    const badge = document.getElementById('tab-wb-badge');
    return {
      id: id,
      rowText: rowText,
      count: Object.keys(saved.wordbook).length,
      entry: entry,
      starOn: star.classList.contains('on') && star.textContent === '⭐',
      badgeShown: !badge.hasAttribute('hidden') && badge.textContent === '1',
      practiceNum: document.getElementById('practice-wb-num').textContent
    };
  `);
  check('T4 单词库可点 ☆ 收藏单词', t4.count === 1 && !!t4.entry, `${t4.rowText.trim()} → ${JSON.stringify(t4.entry)}`);
  check('T4 收藏后星标与角标同步', t4.starOn && t4.badgeShown, `角标=${t4.badgeShown}`);
  check('T4 今日页显示单词本数量', /1/.test(t4.practiceNum), t4.practiceNum);

  await ev(`document.querySelector('#tabbar [data-go="wordbook"]').click(); return true;`);
  const wb = await waitFor(`return document.querySelectorAll('#wb-list .word-row').length > 0;`, 6000, '单词本列表渲染') && await ev(`
    const rows = document.querySelectorAll('#wb-list .word-row');
    return {
      rows: rows.length,
      count: document.getElementById('wb-count').textContent,
      state: (rows[0].querySelector('.w-state')||{}).textContent || '',
      first: (rows[0].querySelector('.w-en')||{}).textContent || ''
    };
  `);
  check('T4 单词本页面列出收藏的词', wb.rows === 1 && /1 词/.test(wb.count), `${wb.first.trim()} · ${wb.state}`);

  // -------------------------------------------- T5 刷新后自动弹出闯关
  await goto(APP);
  const gate = await waitFor(`return !document.getElementById('gate').hasAttribute('hidden');`, 6000, '单词本闸门自动弹出');
  const gateInfo = await ev(`
    return {
      visible: !document.getElementById('gate').hasAttribute('hidden'),
      progress: document.getElementById('gate-progress').textContent,
      sub: document.getElementById('gate-sub').textContent,
      listRows: document.querySelectorAll('#gate-body .gate-list .word-row').length,
      startText: document.getElementById('gate-start').textContent,
      skipHidden: document.getElementById('gate-skip').hasAttribute('hidden'),
      appBehind: !document.getElementById('app').hasAttribute('hidden')
    };
  `);
  check('T5 打开网页自动弹出单词本闯关', gate && gateInfo.visible);
  check('T5 闸门显示待过关词数', /共 1 词/.test(gateInfo.progress) && gateInfo.listRows === 1, gateInfo.progress);
  check('T5 闸门有开始按钮、默认隐藏家长跳过', /开始闯关/.test(gateInfo.startText) && gateInfo.skipHidden, gateInfo.startText.trim());

  const overlay = await ev(`
    const g = document.getElementById('gate');
    const cs = getComputedStyle(g);
    const r = g.getBoundingClientRect();
    const app = document.getElementById('app');
    const zs = [app, ...app.querySelectorAll('*')].reduce((m, el) => Math.max(m, Number(getComputedStyle(el).zIndex) || 0), 0);
    return {
      fixed: cs.position === 'fixed',
      full: Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2,
      z: Number(cs.zIndex) || 0,
      appMaxZ: zs,
      appBehind: ${JSON.stringify(true)}
    };
  `);
  check('T5 闸门为全屏遮罩并盖住学习界面', overlay.fixed && overlay.full && overlay.z > overlay.appMaxZ, `遮罩 z=${overlay.z} vs 页面 z=${overlay.appMaxZ}`);

  // 单击开始闯关 → 出题
  await ev(`document.getElementById('gate-start').click(); return true;`);
  await waitFor(`return !!document.querySelector('#gate-body .opt, #gate-body .ruled-grid');`, 6000, '闸门出题');
  const firstQ = await ev(`
    return {
      qnum: (document.querySelector('.gate-qnum')||{}).textContent || '',
      label: (document.querySelector('.q-label')||{}).textContent || '',
      choice: !!document.querySelector('#gate-body .opt'),
      grid: !!document.querySelector('#gate-body .ruled-grid'),
      cells: document.querySelectorAll('#gate-body .cell').length,
      hint: (document.querySelector('#gate-body .q-pos') || {}).textContent || '',
      zh: (document.querySelector('#gate-body .q-zh')||{}).textContent || ''
    };
  `);
  check('T5 闯关题在五线格或选择题中出题', firstQ.choice || firstQ.grid, `${firstQ.label} | ${firstQ.qnum.trim()}`);
  check('T5 闯关题干给出复习线索', firstQ.choice || !!firstQ.zh || /听发音/.test(firstQ.hint), (firstQ.zh || firstQ.hint).trim());

  // ------------------------------- T6 答对过关 → 全过 → 闸门解除
  const gateWord = await ev(`
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const id = Object.keys(saved.wordbook || {})[0];
    const w = (window.KET_WORDS.words || []).find(x => String(x.id) === String(id));
    return w ? w.word : '';
  `);

  for (let i = 0; i < 8; i++) {
    const st = await ev(`
      const hero = document.querySelector('#gate-body .gate-hero');
      return {
        done: !!(hero && /全部过关/.test(hero.textContent)),
        choice: !!document.querySelector('#gate-body .opt'),
        grid: !!document.querySelector('#gate-body .ruled-grid'),
        next: !!document.querySelector('#gate-next')
      };
    `);
    if (st.done) break;
    if (st.next) {
      await ev(`document.querySelector('#gate-next').click(); return true;`);
      await sleep(350);
      continue;
    }
    if (st.choice) {
      const r = await ev(`
        document.querySelector('#gate-body .opt[data-correct="true"]').click();
        const fb = document.getElementById('gate-feedback');
        return { cls: fb.className, text: fb.textContent.replace(/\\s+/g, ' ').slice(0, 50) };
      `);
      check('T6 选择题选对判定过关', /ok/.test(r.cls), r.text.trim());
    } else if (st.grid) {
      const r = await ev(`
        const inp = document.querySelector('#gate-body .grid-input');
        inp.value = ${JSON.stringify(gateWord)};
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('gate-submit').click();
        const fb = document.getElementById('gate-feedback');
        return {
          cls: fb.className,
          text: fb.textContent.replace(/\\s+/g, ' ').slice(0, 50),
          locked: inp.disabled,
          okCells: document.querySelectorAll('#gate-body .cell.ok').length,
          cells: document.querySelectorAll('#gate-body .cell').length
        };
      `);
      check('T6 五线格拼对判定过关（全格变绿并锁定）', /ok/.test(r.cls) && r.okCells === r.cells && r.locked, r.text.trim());
    } else {
      break;
    }
    await waitFor(`return !!document.querySelector('#gate-next');`, 4000, '闯关反馈');
  }

  // （T5 的校验在下方紧接着执行）
  const doneView = await ev(`
    const hero = document.querySelector('#gate-body .gate-hero');
    return {
      text: hero ? hero.textContent.replace(/\\s+/g, ' ').trim() : '',
      hasRemove: !!document.getElementById('gate-remove'),
      removeChecked: (document.querySelector('#gate-remove') || {}).checked,
      startText: document.getElementById('gate-start').textContent,
      progress: document.getElementById('gate-progress').textContent,
      barWidth: document.getElementById('gate-bar').style.width
    };
  `);
  check('T6 全部答对后出现通关页面', /全部过关/.test(doneView.text), doneView.text.slice(0, 40));
  check('T6 通关进度与文案更新', /1 \/ 1/.test(doneView.progress) && doneView.barWidth === '100%', `${doneView.progress} / ${doneView.barWidth}`);
  check('T6 通关后可勾选移出单词本', doneView.hasRemove && doneView.removeChecked);
  check('T6 按钮变为进入学习', /单词星球/.test(doneView.startText), doneView.startText.trim());

  const after = await ev(`
    document.getElementById('gate-start').click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const log = saved.dailyLogs && Object.values(saved.dailyLogs)[0];
    return {
      gateHidden: document.getElementById('gate').hasAttribute('hidden'),
      wbLeft: Object.keys(saved.wordbook || {}).length,
      badgeHidden: document.getElementById('tab-wb-badge').hasAttribute('hidden'),
      todayVisible: !document.getElementById('screen-today').hasAttribute('hidden'),
      srsRecords: Object.keys(saved.words || {}).length,
      answered: log ? log.totalCount : 0
    };
  `);
  check('T6 点击后闸门关闭并解除限制', after.gateHidden && after.todayVisible);
  check('T6 过关的词按勾选移出单词本', after.wbLeft === 0 && after.badgeHidden, `剩余 ${after.wbLeft} 词`);
  check('T6 闯关计入学习统计与 SRS', after.srsRecords > 0 && after.answered > 0, `${after.answered} 次答题 / ${after.srsRecords} 条 SRS`);

  // ---------------------------------- T7 空单词本 / 开关关闭时不弹窗
  await goto(APP);
  const emptyAgain = await ev(`return document.getElementById('gate').hasAttribute('hidden');`);
  check('T7 单词本清空后刷新不再弹闸门', emptyAgain);

  await ev(`
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const realId = (window.KET_WORDS.words || [])[0].id;
    window.__wbTestId = realId;
    saved.wordbook = {};
    saved.wordbook[realId] = { addedAt: '2026-01-01', passes: 0, lastPassed: '', source: 'manual' };
    saved.wordbookGateEnabled = false;
    localStorage.setItem('ket_planet_v1', JSON.stringify(saved));
    return true;
  `);
  await goto(APP);
  const disabled = await ev(`
    const gateHidden = document.getElementById('gate').hasAttribute('hidden');
    document.querySelector('#tabbar [data-go="wordbook"]').click();
    const rows = document.querySelectorAll('#wb-list .word-row').length;
    document.querySelector('#tabbar [data-go="report"]').click();
    return { gateHidden, rows, gateChecked: document.getElementById('set-gate').checked };
  `);
  check('T7 关闭「先过单词本关」后刷新不弹窗', disabled.gateHidden && disabled.gateChecked === false);
  check('T7 单词本仍显示手动收藏的词', disabled.rows === 1, `${disabled.rows} 行`);

  await ev(`
    const cb = document.getElementById('set-gate');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#tabbar [data-go="wordbook"]').click();
    document.getElementById('btn-wb-gate').click();
    return true;
  `);
  const manualReady = await waitFor(`return !document.getElementById('gate').hasAttribute('hidden');`, 5000, '手动打开闯关');
  const manualGate = manualReady ? await ev(`
    return {
      progress: document.getElementById('gate-progress').textContent,
      row: (document.querySelector('#gate-body .gate-list .word-row .w-en') || {}).textContent || ''
    };
  `) : null;
  check('T7 可在单词本页手动开始闯关', !!manualGate, manualGate ? `${manualGate.progress} · ${manualGate.row.trim()}` : '未弹出');

  // ------------------- T8 答错重排到队尾 + 连错止损 + 多词顺序过关
  const pickWord = await ev(`
    const words = window.KET_WORDS.words || [];
    const pick = words.find(w => w.word === 'apple') || words.find(w => /^[a-z]{5}$/.test(w.word)) || words[0];
    const second = words.find(w => w.word === 'about') || words.find(w => /^[a-z]{6}$/.test(w.word)) || words[1];
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    saved.wordbook = {};
    saved.wordbook[pick.id] = { addedAt: '2026-01-01', passes: 0, lastPassed: '', source: 'manual' };
    saved.wordbook[second.id] = { addedAt: '2026-01-02', passes: 0, lastPassed: '', source: 'manual' };
    saved.wordbookGateEnabled = true;
    localStorage.setItem('ket_planet_v1', JSON.stringify(saved));
    localStorage.setItem('ket_test_pick', pick.word);
    localStorage.setItem('ket_test_second', second.word);
    return { pick: pick.word, second: second.word };
  `);

  await goto(APP);
  await waitFor(`return !document.getElementById('gate').hasAttribute('hidden');`, 6000, '闸门弹出（2 词）');
  await ev(`
    window.confirm = function () { return true; };
    document.getElementById('gate-start').click();
    return true;
  `);
  await waitFor(`return !!document.querySelector('#gate-body .opt, #gate-body .ruled-grid');`, 6000, '闯关出题');

  // 连续答错 4 次
  const wrongStates = [];
  for (let i = 0; i < 4; i++) {
    const r = await ev(`
      if (document.querySelector('#gate-body .opt')) {
        document.querySelector('#gate-body .opt[data-correct="false"]').click();
      } else {
        const inp = document.querySelector('#gate-body .grid-input');
        inp.value = 'zzzzzzzz';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('gate-submit').click();
      }
      const fb = document.getElementById('gate-feedback');
      return {
        cls: fb.className,
        qnum: (document.querySelector('.gate-qnum') || {}).textContent || '',
        progress: document.getElementById('gate-progress').textContent,
        skipVisible: !document.getElementById('gate-skip').hasAttribute('hidden'),
        fbText: fb.textContent.replace(/\\s+/g, ' ').slice(0, 40)
      };
    `);
    wrongStates.push(r);
    await waitFor(`return !!document.querySelector('#gate-next');`, 4000, '错题反馈');
    await ev(`document.querySelector('#gate-next').click(); return true;`);
    await sleep(300);
  }
  check('T8 答错判为未过关', wrongStates.every(s => /no/.test(s.cls)), wrongStates[0].fbText.trim());
  const q4 = (/第\s*(\d+)\s*\/\s*(\d+)\s*题/.exec(wrongStates[3].qnum) || []);
  check('T8 答错的词排到队尾（题目总数增加）', q4[1] === '4' && Number(q4[2]) >= 5 && /过 0 \/ 2/.test(wrongStates[3].progress), `${wrongStates[3].qnum.trim()} · ${wrongStates[3].progress}`);
  check('T8 连续答错 4 次后出现「家长跳过」', wrongStates[3].skipVisible === true);

  // 用中文释义反查正确答案，逐题答对 → 全部过关
  let loopGuard = 0;
  let doneText = '';
  while (loopGuard++ < 14) {
    const st = await ev(`
      const hero = document.querySelector('#gate-body .gate-hero');
      const next = document.querySelector('#gate-next');
      if (next) { next.click(); return { action: 'next' }; }
      if (hero && /全部过关/.test(hero.textContent)) {
        return { action: 'done', text: hero.textContent.replace(/\\s+/g, ' ').trim() };
      }
      if (document.querySelector('#gate-body .opt')) {
        document.querySelector('#gate-body .opt[data-correct="true"]').click();
        return { action: 'pick' };
      }
      if (document.querySelector('#gate-body .ruled-grid')) {
        const zh = (document.querySelector('#gate-body .q-zh') || {}).textContent || '';
        const cells = document.querySelectorAll('#gate-body .cell').length;
        const cand = (window.KET_WORDS.words || []).filter(w => w.zh === zh && w.word.replace(/\\s/g, '').length === cells);
        const hit = cand[0] || { word: '' };
        const inp = document.querySelector('#gate-body .grid-input');
        inp.value = hit.word;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('gate-submit').click();
        return { action: 'type', word: hit.word };
      }
      return { action: 'idle' };
    `);
    if (st.action === 'done') { doneText = st.text; break; }
    await sleep(350);
  }
  const lastProgress = await ev(`return document.getElementById('gate-progress').textContent;`);
  check('T8 逐词答对后全部过关', /全部过关/.test(doneText) && /2 \/ 2/.test(lastProgress), lastProgress);

  // 勾选移出 + 进入学习 → 闸门关闭、单词本清空、SRS 盒号提升
  const finalState = await ev(`
    const chk = document.getElementById('gate-remove');
    if (chk && !chk.checked) chk.click();
    document.getElementById('gate-start').click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    const words = (window.KET_WORDS.words || []);
    const ids = words.filter(w => w.word === localStorage.getItem('ket_test_pick') || w.word === localStorage.getItem('ket_test_second')).map(w => w.id);
    const recs = ids.map(id => saved.words[id]).filter(Boolean);
    return {
      gateHidden: document.getElementById('gate').hasAttribute('hidden'),
      wbLeft: Object.keys(saved.wordbook || {}).length,
      boxes: recs.map(r => r.box).join(','),
      picked: ids.length
    };
  `);
  check('T8 全部过关后闸门关闭、单词本清空', finalState.gateHidden && finalState.wbLeft === 0, `剩余 ${finalState.wbLeft} 词`);
  check('T8 过关的词 SRS 盒号提升', finalState.picked === 2 && !/(^|,)0(,|$)/.test(finalState.boxes), `box=${finalState.boxes}`);

  // ------------------- T9 真实键盘输入（CDP Input 事件 + 隐藏 input 焦点）
  await ev(`localStorage.clear(); return true;`);
  await goto(APP);
  await ev(`document.getElementById('btn-practice-definition').click(); return true;`);
  await waitFor(`return !!document.querySelector('#grid-mount .ruled-grid');`, 6000, '看释义猜词出题');
  await ev(`document.querySelector('#grid-mount .grid-input').focus(); return true;`);

  // 真键盘敲一个字母 → 应落到五线格并显示格子光标
  await typeChar('a');
  const key1 = await ev(`
    const inp = document.querySelector('#grid-mount .grid-input');
    const glyph = [...document.querySelectorAll('#grid-mount .cell')].map(c => c.querySelector('.glyph').textContent).join('');
    return {
      focused: document.activeElement === inp,
      value: inp.value,
      glyph: glyph,
      screen: document.querySelector('.screen:not([hidden])').id
    };
  `);
  check('T9 真键盘输入进入隐藏输入框（保持焦点）', key1.focused && key1.value.length === 1, `value=${key1.value}`);
  check('T9 键入字母实时画到五线格', key1.glyph[0] === key1.value, `格内=${key1.glyph}`);
  check('T9 输入时不误触页面快捷键', key1.screen === 'screen-study', key1.screen);

  // 退格应删掉一个字符
  await pressBackspace();
  const afterBs = await ev(`return document.querySelector('#grid-mount .grid-input').value;`);

  // 用释义反查答案 → 全键盘输入 → Enter 提交
  const typed = await ev(`
    const zh = (document.querySelector('.q-zh') || {}).textContent || '';
    const cells = document.querySelectorAll('#grid-mount .cell').length;
    const cand = (window.KET_WORDS.words || []).filter(w => w.zh === zh && w.word.replace(/\\s/g, '').length === cells);
    return (cand[0] || { word: '' }).word;
  `);
  await ev(`
    const inp = document.querySelector('#grid-mount .grid-input');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.focus();
    return true;
  `);
  for (const ch of typed) await typeChar(ch);
  const typedValue = await ev(`return document.querySelector('#grid-mount .grid-input').value;`);
  await pressEnter();
  const enterRes = await waitFor(`return !!document.querySelector('#card-feedback.feedback');`, 4000, 'Enter 提交');
  const fb = await ev(`
    const f = document.querySelector('#card-feedback');
    return {
      cls: f ? f.className : 'none',
      text: f ? f.textContent.replace(/\\s+/g, ' ').slice(0, 40) : '(无反馈)',
      green: document.querySelectorAll('#grid-mount .cell.ok').length,
      locked: document.querySelector('#grid-mount .grid-input').disabled
    };
  `);
  check('T9 退格删除一个字符', afterBs === key1.value.slice(0, -1), `"${afterBs}"`);
  check('T9 键盘逐字母输入完整答案', typed.length > 0 && typedValue === typed, `"${typedValue}"`);
  check('T9 五线格内按 Enter 触发提交', enterRes && /ok/.test(fb.cls), fb.text.trim());
  check('T9 答对后整格变绿并锁定', fb.green === typed.replace(/\\s/g, '').length && fb.locked, `${fb.green} 格绿 / locked=${fb.locked}`);

  // 闸门内用真实 Enter 推进 → 验证不会与后台学习界面快捷键冲突
  const kbGateWord = await ev(`
    const words = window.KET_WORDS.words || [];
    const pick = words.find(w => w.word === 'apple') || words[0];
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1') || '{}');
    saved.wordbook = {};
    saved.wordbook[pick.id] = { addedAt: '2026-01-01', passes: 0, lastPassed: '', source: 'manual' };
    saved.wordbookGateEnabled = true;
    localStorage.setItem('ket_planet_v1', JSON.stringify(saved));
    return pick.word;
  `);
  await goto(APP);
  await waitFor(`return !document.getElementById('gate').hasAttribute('hidden');`, 6000, '闸门弹出（键盘流）');
  await ev(`document.getElementById('gate-start').click(); return true;`);
  await waitFor(`return !!document.querySelector('#gate-body .opt, #gate-body .ruled-grid');`, 6000, '闸门出题');
  await ev(`
    if (document.querySelector('#gate-body .opt')) {
      document.querySelector('#gate-body .opt[data-correct="true"]').click();
    } else {
      const inp = document.querySelector('#gate-body .grid-input');
      inp.value = ${JSON.stringify('PLACEHOLDER')};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('gate-submit').click();
    }
    return true;
  `.replace('PLACEHOLDER', kbGateWord));
  await waitFor(`return !!document.getElementById('gate-next');`, 4000, '过关反馈');
  await pressEnter();
  const kbDone = await waitFor(
    `return /全部过关/.test((document.querySelector('#gate-body .gate-hero') || {}).textContent || '');`,
    4000, 'Enter 推进到通关页'
  );
  const kbState = await ev(`
    return {
      progress: document.getElementById('gate-progress').textContent,
      studyHidden: document.getElementById('screen-study').hasAttribute('hidden'),
      todayVisible: !document.getElementById('screen-today').hasAttribute('hidden')
    };
  `);
  check('T9 闸门内真键盘 Enter 推进一步到通关页', kbDone && /1 \/ 1/.test(kbState.progress), kbState.progress);
  check('T9 闸门键盘不会误动后台页面', kbState.studyHidden && kbState.todayVisible);

  // ------------------------------------- T11 五线格预填空格 / 符号，只输入字母
  await goto(APP);
  const t11 = await ev(`
    const box = document.createElement('div');
    document.body.appendChild(box);
    const g = new window.RuledGrid({ mount: box, target: 'T-shirt' });
    const cells = box.querySelectorAll('.cell').length;
    const fixed = Array.from(box.querySelectorAll('.cell.fixed .glyph')).map(x => x.textContent).join('');
    g.input.value = 'tshirt'; g.input.dispatchEvent(new Event('input', { bubbles: true }));
    const merged = g.value, ok1 = g.isCorrect();
    g.input.value = 't-shirt'; g.input.dispatchEvent(new Event('input', { bubbles: true }));
    const typedDash = g.input.value, ok2 = g.isCorrect();
    const box2 = document.createElement('div');
    document.body.appendChild(box2);
    const g2 = new window.RuledGrid({ mount: box2, target: 'dvd player' });
    const space = box2.querySelectorAll('.cell.space').length;
    g2.input.value = 'dvdplayer'; g2.input.dispatchEvent(new Event('input', { bubbles: true }));
    g2.lock(true);
    const okCells = box2.querySelectorAll('.cell.ok').length, allCells = box2.querySelectorAll('.cell').length;
    box.remove(); box2.remove();
    return { cells, fixed, merged, ok1, typedDash, ok2, space, okCells, allCells,
      hint1: window.gridHint('T-shirt'), hint2: window.gridHint('apple') };
  `);
  check('T11 连字符预填成固定格', t11.cells === 7 && t11.fixed === '-', `${t11.cells} 格, 固定=${t11.fixed}`);
  check('T11 只敲字母即可拼对', t11.ok1 && t11.merged === 't-shirt', t11.merged);
  check('T11 孩子自己敲的符号被忽略', t11.ok2 && t11.typedDash === 'tshirt', t11.typedDash);
  check('T11 词组空格预填、答对后全格变绿', t11.space === 1 && t11.okCells === t11.allCells, `${t11.okCells}/${t11.allCells}`);
  check('T11 提示写明字母数与已画好的符号', /7 格：写 6 个字母/.test(t11.hint1) && /（5 格）/.test(t11.hint2), t11.hint1);

  // ------------------------------------- T12 例句挖空：只读 sent、所有位置都挖、每段长度 = 字母数
  const t12 = await ev(`
    const words = window.KET_WORDS.words;
    const g = new window.ExerciseGenerator(words);
    let empty = 0, mismatch = 0, multi = 0;
    for (const w of words) {
      const b = g.buildBlankedExample(w);
      if (!b) { empty++; continue; }
      const occ = (g.buildHighlightedExample(w).match(/<mark>/g) || []).length;
      if (occ > 1) multi++;
      const underscores = (b.match(/_/g) || []).length;
      if (underscores !== w.word.replace(/[^A-Za-z]/g, '').length * occ) mismatch++;
    }
    const ts = words.find(w => w.word === 'T-shirt');
    return { total: words.length, empty, mismatch, multi, tshirt: ts ? g.buildBlankedExample(ts) : '' };
  `);
  check('T12 每个词的例句都能挖空', t12.empty === 0, `${t12.total} 词, 未挖空 ${t12.empty}`);
  check('T12 挖空长度与原文一致（含多处出现）', t12.mismatch === 0 && t12.multi > 0, `多处出现 ${t12.multi} 词, 不一致 ${t12.mismatch}`);
  check('T12 符号在挖空里原样保留', t12.tshirt.includes('<u>_</u>-<u>_____</u>'), t12.tshirt);

  // ------------------------------------- T13 3 轮过词
  await ev(`localStorage.clear(); return true;`);
  await goto(APP);
  const t13a = await ev(`return document.getElementById('today-summary').textContent;`);
  check('T13 今日页显示第 1 轮计划', /第 1 轮/.test(t13a), t13a);
  await ev(`document.getElementById('btn-start').click(); return true;`);
  await waitFor(`return !!document.querySelector('#study-card .opt');`, 6000, '第 1 轮题目');
  const t13b = await ev(`
    const label = document.querySelector('.q-label').textContent;
    document.querySelector('#study-card .opt[data-correct="true"]').click();
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1'));
    const passed = Object.values(saved.words).filter(r => r.passes === 1).length;
    const log = saved.dailyLogs[Object.keys(saved.dailyLogs)[0]];
    return { label, passed, passCount: log.passCount,
      sent: (document.querySelector('#card-feedback .fb-sent') || {}).innerHTML || '' };
  `);
  check('T13 第 1 轮出认识类题型', /看英文选中文|听发音选中文/.test(t13b.label), t13b.label);
  check('T13 答对记为过了第 1 轮', t13b.passed === 1 && t13b.passCount === 1, `passes=1 的词 ${t13b.passed}, 今日过词 ${t13b.passCount}`);
  check('T13 答完显示完整例句并高亮目标词', /<mark>/.test(t13b.sent), t13b.sent.replace(/<[^>]+>/g, ''));

  // 把全部词设为已过 2 轮 → 应进入第 3 轮拼写
  await ev(`
    const saved = JSON.parse(localStorage.getItem('ket_planet_v1'));
    for (const w of window.KET_WORDS.words) {
      saved.words[w.id] = Object.assign({ box: 1, reps: 2, lapses: 0, correct: 2, interval: 1, ease: 2.5,
        nextReview: '2099-01-01', lastReviewed: '2000-01-01', firstLearned: '2000-01-01' },
        saved.words[w.id] || {}, { passes: 2, lastPassDate: '2000-01-01' });
    }
    localStorage.setItem('ket_planet_v1', JSON.stringify(saved));
    return true;
  `);
  await goto(APP);
  const t13c = await ev(`return document.getElementById('today-summary').textContent;`);
  check('T13 前两轮过完后进入第 3 轮', /第 3 轮/.test(t13c), t13c);
  await ev(`document.getElementById('btn-start').click(); return true;`);
  await waitFor(`return !!document.querySelector('#grid-mount .ruled-grid');`, 6000, '第 3 轮题目');
  const t13d = await ev(`return document.querySelector('.q-label').textContent;`);
  check('T13 第 3 轮出五线格拼写题', /五线格/.test(t13d), t13d);

  // ------------------------------------- T14 按主题听音写词
  await ev(`localStorage.clear(); return true;`);
  await goto(APP);
  const t14a = await ev(`
    const sel = document.getElementById('practice-topic');
    const opts = Array.from(sel.options).map(o => o.textContent);
    return { first: opts[0], count: opts.length, untagged: opts.find(t => /^未分类/.test(t)) || '',
      days: opts.find(t => /^Days of the week/.test(t)) || '' };
  `);
  check('T14 主题下拉框默认「今日词」并列出全部主题', /今日词/.test(t14a.first) && t14a.count === 31, `${t14a.count} 项`);
  check('T14 无主题的词归到「未分类」', /未分类（\d+）/.test(t14a.untagged), t14a.untagged);
  await ev(`
    const sel = document.getElementById('practice-topic');
    sel.value = Array.from(sel.options).find(o => /^Days of the week/.test(o.textContent)).value;
    document.getElementById('btn-practice-dictation').click();
    return true;
  `);
  await waitFor(`return !!document.querySelector('#grid-mount .ruled-grid');`, 6000, '主题听写题目');
  const t14b = await ev(`
    const toast = Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join(' | ');
    return { label: document.querySelector('.q-label').textContent, toast };
  `);
  const daysCount = Number((t14a.days.match(/（(\d+)）/) || [0, 0])[1]);
  check('T14 按主题开出听音拼写会话', /听音拼写/.test(t14b.label) && t14b.toast.includes(`共 ${daysCount} 词`), t14b.toast);

  // 「未分类」星球不再开出空会话
  await goto(APP);
  await ev(`document.querySelector('.tab[data-go="planets"]').click(); return true;`);
  await ev(`document.querySelector('.unit[data-topic="General"]').click(); return true;`);
  const t14c = await waitFor(`return !!document.querySelector('#study-card .q-label');`, 4000, '未分类星球题目');
  check('T14 点「未分类」星球能正常出题', t14c);

  // ---------------------------------------------------- T10 运行期报错检查
  const realErrors = pageErrors.filter(e => !/AudioContext|speech|Speech/i.test(e));
  check('T10 页面运行无 JS 报错', realErrors.length === 0, realErrors.length ? realErrors.join(' | ') : '无');
  if (pageErrors.length && realErrors.length === 0) {
    console.log('   （已忽略音频/语音相关告警 ' + pageErrors.length + ' 条）');
  }
}

main()
  .then(() => {
    const failed = results.filter(r => !r.ok);
    console.log('\n========== 结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 ==========');
    if (failed.length) {
      failed.forEach(f => console.log('  ✗ ' + f.name + (f.extra ? '  → ' + f.extra : '')));
      process.exitCode = 1;
    }
  })
  .catch(err => {
    console.error('测试脚本异常:', err);
    process.exitCode = 2;
  })
  .finally(() => { try { if (ws) ws.close(); } catch (e) {} });

