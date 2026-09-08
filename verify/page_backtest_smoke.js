/* 백테스트 페이지 렌더 스모크 테스트.
 *
 *   node verify/page_backtest_smoke.js
 *
 * jsdom 없이 최소 DOM 을 흉내내 backtest-app.js 를 실제로 실행한다.
 * fetch 는 data/ 의 진짜 CSV 를 돌려준다 — 받아오기부터 표 렌더까지 한 번에 지난다.
 * backtest.html 에 없는 id 를 앱이 찾으면 즉시 실패시킨다 (브라우저에서 백지 페이지가 된다).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const DATA = path.join(__dirname, '..', 'data');
const html = fs.readFileSync(path.join(DIST, 'backtest.html'), 'utf8');

const ids = new Set();
html.replace(/\bid="([^"]+)"/g, (_, v) => ids.add(v));
// innerHTML 로 그려 넣는 id (오프라인 폴백의 파일 선택기)
const DYNAMIC = new Set(['csvPick']);

const metas = {};
html.replace(/<meta\s+name="([^"]+)"[\s\S]{0,400}?content="([^"]*)"/g,
  (_, n, c) => { metas[n] = c; });

function makeSandbox(fetchImpl) {
  const missing = [], els = new Map();
  const mkEl = (id) => {
    const el = {
      id, _html: '', textContent: '', className: '', value: '', checked: false,
      hidden: true, disabled: false, min: '', max: '',
      style: {}, dataset: {},
      clientWidth: 760, clientHeight: 330, offsetWidth: 160, offsetHeight: 70,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, removeEventListener() {}, remove() {},
      appendChild() {}, setAttribute() {}, focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 760, height: 330 }),
      querySelector: () => mkEl('(anon)'),
      querySelectorAll: () => [],
      closest: () => null,
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); },
    });
    return el;
  };
  const doc = {
    documentElement: mkEl('(root)'),
    getElementById(id) {
      if (!ids.has(id) && !DYNAMIC.has(id)) { missing.push(id); return null; }
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
  const mem = {};
  const sb = {
    console, document: doc,
    getComputedStyle: () => ({ getPropertyValue: () => '#2a78d6' }),
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
    FileReader: function () {},
    fetch: fetchImpl,
    innerWidth: 1200, innerHeight: 900,
    addEventListener() {},
    Promise, setTimeout, clearTimeout,
    Array, Object, JSON, Math, Number, String, Boolean, Date, Error,
    isNaN, parseFloat, parseInt, isFinite,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return { sb, els, missing };
}

function loadAll(sb) {
  const errs = [];
  for (const f of ['spec.js', 'backtest.js', 'backtest-app.js']) {
    try {
      vm.runInContext(fs.readFileSync(path.join(DIST, f), 'utf8'), sb, { filename: f });
    } catch (e) { errs.push([f, e]); }
  }
  return errs;
}

console.log('='.repeat(78));
console.log('백테스트 페이지 렌더 스모크 테스트');
console.log('='.repeat(78));
console.log(`  backtest.html 이 정의한 id ${ids.size}개`);

let fail = 0;

// ── 1) 정상 경로 — 진짜 CSV 를 받아 전체 구간을 렌더한다
const csvText = {
  'SOXL_OHLC.csv': fs.readFileSync(path.join(DATA, 'SOXL_OHLC.csv'), 'utf8'),
  'SOXS_OHLC.csv': fs.readFileSync(path.join(DATA, 'SOXS_OHLC.csv'), 'utf8'),
  'qqq_regime.csv': fs.readFileSync(path.join(DATA, 'qqq_regime.csv'), 'utf8'),
};
let fetched = 0;
const okFetch = (url) => {
  const name = String(url).split('/').pop();
  fetched++;
  if (!(name in csvText)) return Promise.reject(new Error('없는 파일 ' + name));
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(csvText[name]) });
};

const A = makeSandbox(okFetch);
for (const [f, e] of loadAll(A.sb)) {
  fail++;
  console.log(`  [실패] ${f} — ${e.message}`);
  if (e.stack) console.log('        ' + e.stack.split('\n').slice(1, 3).join('\n        '));
}

// fetch 는 마이크로태스크로 이어진다 — 체인이 끝날 때까지 기다린다
setTimeout(() => {
  const t = (id) => (A.els.get(id) ? A.els.get(id).textContent : '');
  const h = (id) => (A.els.get(id) ? A.els.get(id)._html : '');

  if (A.missing.length) {
    fail++;
    console.log('\n  [실패] 앱이 backtest.html 에 없는 id 를 찾았습니다:');
    [...new Set(A.missing)].forEach((m) => console.log(`         #${m}`));
  }
  console.log(`  CSV fetch ${fetched}회`);

  const want = ['statRow', 'eqChart', 'ddChart', 'eqLegend', 'yearRows', 'tradeRows', 'cmpRows'];
  console.log('\n  렌더된 영역:');
  const empty = want.filter((id) => !h(id).trim());
  want.forEach((id) => console.log(
    `    ${empty.includes(id) ? '[비어있음]' : '[OK]      '} #${id.padEnd(10)} ${h(id).length.toLocaleString()}자`));
  if (empty.length) fail++;

  console.log('\n  주요 표시값:');
  [['dataRange', '데이터'], ['dataState', '상태'], ['rangeTag', '구간'],
   ['perfTitle', '구성'], ['perfTag', '연수'], ['yearTag', '연도'],
   ['tradeTag', '체결'], ['cmpTag', '비교']]
    .forEach(([id, label]) => console.log(`    ${label.padEnd(6)} ${t(id) || '(빈값)'}`));
  const blanks = ['dataRange', 'rangeTag', 'perfTitle', 'yearTag', 'tradeTag', 'cmpTag']
    .filter((id) => !t(id) || t(id) === '—');
  if (blanks.length) { fail++; console.log(`  [실패] 빈 표시값: ${blanks.join(', ')}`); }

  // 화면에 찍힌 수치가 검증된 엔진 값과 같은지 (기대값 파일이 있을 때만)
  const EXP = path.join(__dirname, '_backtest_expected.json');
  if (fs.existsSync(EXP)) {
    const exp = JSON.parse(fs.readFileSync(EXP, 'utf8'));
    const c = exp.cases[0];                       // 전체 구간 · 동적 = 페이지 기본값
    const cagr = `+${(c.cagr * 100).toFixed(2)}%`;
    const mdd = `${(c.mdd * 100).toFixed(2)}%`;
    const fin = Math.round(c.final).toLocaleString('en-US');
    console.log('\n  기본 구간(전체·동적) 수치 대조:');
    [[cagr, 'CAGR'], [mdd, 'MDD']].forEach(([v, label]) => {
      const ok = h('statRow').includes(v);
      if (!ok) fail++;
      console.log(`    ${ok ? '[OK]  ' : '[실패]'} ${label} ${v}`);
    });
    const finOk = h('cmpRows').includes(fin);
    if (!finOk) fail++;
    console.log(`    ${finOk ? '[OK]  ' : '[실패]'} 최종자산 $${fin} (비교표)`);
  } else {
    console.log('\n  (건너뜀) 수치 대조 — 먼저 python verify/page_backtest.py');
  }

  // 모바일 카드 라벨이 실제 표 헤더와 맞는지
  // (컬럼이 바뀌었는데 CSS 라벨을 안 고치면 좁은 화면에서 엉뚱한 라벨이 붙는다)
  console.log('\n  모바일 컬럼 라벨:');
  {
    const css = fs.readFileSync(path.join(DIST, 'backtest.css'), 'utf8');
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
        const n = i + 1, got = rules.get(n);
        if (got === undefined) { if (t) bad.push(`${n}번 라벨 없음 (헤더 "${t}")`); return; }
        if (got !== t) bad.push(`${n}번 "${got}" != 헤더 "${t}"`);
      });
      [...rules.keys()].filter((n) => n > ths.length)
        .forEach((n) => bad.push(`${n}번 라벨이 헤더(${ths.length}컬럼)를 넘음`));
      if (bad.length) { fail++; console.log(`    [실패] #${id}: ${bad.join(', ')}`); }
      else console.log(`    [OK]    #${id}  ${ths.length}컬럼 라벨 일치`);
    });
  }

  // ── 2) 오프라인 경로 — fetch 가 죽어도 파일 선택 안내가 떠야 한다
  const B = makeSandbox(() => Promise.reject(new Error('offline (test)')));
  for (const [f, e] of loadAll(B.sb)) { fail++; console.log(`  [실패/오프라인] ${f} — ${e.message}`); }
  setTimeout(() => {
    const warn = B.els.get('loadWarn') ? B.els.get('loadWarn')._html : '';
    console.log('\n  오프라인 폴백:');
    console.log(`    안내 문구 ${warn ? warn.replace(/<[^>]+>/g, ' ').trim().slice(0, 60) + '…' : '(없음)'}`);
    if (!warn.includes('csvPick')) { fail++; console.log('    [실패] CSV 직접 선택 입력이 없습니다'); }
    if (B.missing.length) {
      fail++;
      console.log('    [실패] 오프라인 경로에서 없는 id: ' + [...new Set(B.missing)].join(', '));
    }

    console.log('\n' + '='.repeat(78));
    console.log(fail ? `실패 ${fail}건` : '통과 — 백테스트 페이지가 정상 렌더됩니다');
    process.exit(fail ? 1 : 0);
  }, 0);
}, 0);
