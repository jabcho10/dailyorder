/* 주문 페이지 렌더 스모크 테스트.
 *
 *   node verify/page_smoke.js
 *
 * jsdom 없이 최소 DOM 을 흉내내 app.js 를 실제로 실행한다.
 * index.html 에 없는 id 를 app.js 가 찾으면 즉시 실패시킨다 —
 * 이런 불일치는 브라우저에서 백지 페이지로 나타나기 때문이다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

// index.html 이 실제로 정의한 id 목록
const ids = new Set();
html.replace(/\bid="([^"]+)"/g, (_, v) => ids.add(v));

const missing = [], writes = {};
const mkEl = (id) => {
  const el = {
    id, _html: '', textContent: '', className: '', value: '', checked: false,
    style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, focus() {},
    querySelectorAll: () => [], querySelector: () => null,
    appendChild() {}, closest: () => null,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); writes[id] = (writes[id] || 0) + 1; },
  });
  return el;
};

// index.html 의 <meta name="..."> 를 그대로 흉내낸다
const metas = {};
html.replace(/<meta\s+name="([^"]+)"[\s\S]{0,400}?content="([^"]*)"/g,
  (_, n, c) => { metas[n] = c; });

const els = new Map();
const doc = {
  getElementById(id) {
    if (!ids.has(id)) { missing.push(id); return null; }
    if (!els.has(id)) els.set(id, mkEl(id));
    return els.get(id);
  },
  querySelector(sel) {
    const m = /^meta\[name="([^"]+)"\]$/.exec(sel);
    if (m) {
      if (!(m[1] in metas)) return null;
      return { getAttribute: (a) => (a === 'content' ? metas[m[1]] : null) };
    }
    return null;
  },
  querySelectorAll: () => [],
  createElement: mkEl,
};

// 오프라인 상황을 가정한다 — 폴백 경로가 살아 있어야 한다
let fetchCalls = 0;
const fetchStub = (url) => { fetchCalls++; return Promise.reject(new Error('offline (test)')); };

const storeMem = {};
const sandbox = {
  console,
  document: doc,
  localStorage: {
    getItem: (k) => (k in storeMem ? storeMem[k] : null),
    setItem: (k, v) => { storeMem[k] = String(v); },
    removeItem: (k) => { delete storeMem[k]; },
  },
  FileReader: function () {},
  fetch: fetchStub, Promise, setTimeout, clearTimeout,
  Array, Object, JSON, Math, Number, String, Boolean, Date, isNaN, parseFloat, parseInt,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(file) {
  try {
    vm.runInContext(fs.readFileSync(path.join(DIST, file), 'utf8'), sandbox, { filename: file });
    return null;
  } catch (e) { return e; }
}

console.log('='.repeat(78));
console.log('주문 페이지 렌더 스모크 테스트');
console.log('='.repeat(78));
console.log(`  index.html 이 정의한 id ${ids.size}개`);

let fail = 0;
for (const f of ['data.js', 'spec.js', 'app.js']) {
  const err = run(f);
  if (err) {
    fail++;
    console.log(`  [실패] ${f} — ${err.message}`);
    if (err.stack) console.log('        ' + err.stack.split('\n').slice(1, 3).join('\n        '));
  } else {
    console.log(`  [OK]   ${f}`);
  }
}

if (missing.length) {
  fail++;
  console.log(`\n  [실패] app.js 가 index.html 에 없는 id 를 찾았습니다:`);
  [...new Set(missing)].forEach((m) => console.log(`         #${m}`));
}

// 실제로 내용이 채워졌는지 — 비어 있으면 화면이 빈 채로 뜬다
const want = ['todayOrders', 'todayTotals', 'rebalBox', 'boRows', 'gridEntryRows', 'gridExitRows',
  'checklist', 'rulesGrid', 'holdings', 'planRows', 'planSummary', 'planNote'];
const empty = want.filter((id) => !writes[id] || !els.get(id) || !els.get(id)._html.trim());
console.log('\n  렌더된 영역:');
want.forEach((id) => {
  const el = els.get(id), n = el ? el._html.length : 0;
  console.log(`    ${empty.includes(id) ? '[비어있음]' : '[OK]      '} #${id.padEnd(15)} ${n.toLocaleString()}자`);
});
if (empty.length) fail++;

// 핵심 수치가 화면에 실제로 찍혔는지
const t = (id) => (els.get(id) ? els.get(id).textContent : '');
console.log('\n  주요 표시값:');
[['asOf', '기준일'], ['todayTitle', '오늘주문'], ['todayTag', '건수'],
 ['rsiValue', 'RSI'], ['regimePill', '레짐'], ['closeValue', '종가'],
 ['ma50Value', 'MA50'], ['ma200Value', 'MA200'], ['allocText', '배분'], ['dirText', '방향']]
  .forEach(([id, label]) => console.log(`    ${label.padEnd(6)} ${t(id) || '(빈값)'}`));
const blanks = ['asOf', 'todayTitle', 'todayTag', 'rsiValue', 'closeValue', 'ma200Value', 'allocText', 'dirText']
  .filter((id) => !t(id) || t(id) === '—');
if (blanks.length) { fail++; console.log(`  [실패] 빈 표시값: ${blanks.join(', ')}`); }

// 모바일 카드 라벨이 실제 표 헤더와 맞는지
// (컬럼이 바뀌었는데 CSS 라벨을 안 고치면 좁은 화면에서 엉뚱한 라벨이 붙는다)
console.log('\n  모바일 컬럼 라벨:');
{
  const css = fs.readFileSync(path.join(DIST, 'styles.css'), 'utf8');
  const tables = [...html.matchAll(/<thead>\s*<tr>([\s\S]*?)<\/tr>\s*<\/thead>\s*<tbody id="([^"]+)"/g)];
  if (!tables.length) { fail++; console.log('    [실패] thead/tbody 짝을 찾지 못했습니다'); }
  tables.forEach(([, head, id]) => {
    const ths = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    const rules = new Map();
    const re = new RegExp('#' + id + ' td:nth-child\\((\\d+)\\)::before\\{content:"([^"]*)"\\}', 'g');
    for (const m of css.matchAll(re)) rules.set(+m[1], m[2]);
    if (!rules.size) { console.log(`    (건너뜀) #${id} — 라벨 규칙 없음`); return; }
    const bad = [];
    ths.forEach((t, i) => {
      const n = i + 1, want = t, got = rules.get(n);
      if (got === undefined) { if (want) bad.push(`${n}번 라벨 없음 (헤더 "${want}")`); return; }
      if (got !== want && !(want === '' && got === '')) bad.push(`${n}번 "${got}" != 헤더 "${want}"`);
    });
    [...rules.keys()].filter((n) => n > ths.length)
      .forEach((n) => bad.push(`${n}번 라벨이 헤더(${ths.length}컬럼)를 넘음`));
    if (bad.length) { fail++; console.log(`    [실패] #${id}: ${bad.join(', ')}`); }
    else console.log(`    [OK]    #${id}  ${ths.length}컬럼 라벨 일치`);
  });
}

// 자동 갱신 설정과 오프라인 폴백
console.log('\n  자동 갱신:');
const durl = metas['page-data-url'] || '';
const configured = durl && !durl.includes('OWNER/REPO');
console.log(`    data.json URL  ${durl ? (configured ? durl.slice(0, 60) + '…' : '미설정 (OWNER/REPO 그대로)') : '메타 태그 없음'}`);
console.log(`    fetch 시도     ${fetchCalls}회`);
console.log(`    상태 표시      ${t('dataState') || '(빈값)'}`);
if (!durl) { fail++; console.log('    [실패] page-data-url 메타 태그가 없습니다'); }
if (configured && fetchCalls === 0) { fail++; console.log('    [실패] URL 이 설정됐는데 fetch 를 시도하지 않았습니다'); }
if (!configured && fetchCalls > 0) { fail++; console.log('    [실패] placeholder 인데 fetch 를 시도했습니다'); }
// fetch 가 실패해도 주문값은 그대로 떠 있어야 한다
if (!t('asOf')) { fail++; console.log('    [실패] fetch 실패 후 화면이 비었습니다'); }

console.log('\n' + '='.repeat(78));
console.log(fail ? `실패 ${fail}건` : '통과 — 페이지가 정상 렌더됩니다');
process.exit(fail ? 1 : 0);
