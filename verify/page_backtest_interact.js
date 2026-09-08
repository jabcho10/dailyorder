/* 백테스트 페이지 상호작용 검증.
 *
 *   python verify/page_backtest.py && node verify/page_backtest_interact.js
 *
 * page_backtest_smoke.js 는 "첫 화면"만 본다. 이 검증은 리스너를 실제로 등록·발사해서
 * 프리셋 클릭 · 날짜 직접 입력 · 배분 변경 · SOXS 토글 · 비교군 · 축 토글 · 툴팁이
 * 동작하는지, 그리고 그렇게 바뀐 화면의 수치가 파이썬 엔진 기대값과 같은지 본다.
 *
 * 기간을 바꾸는 페이지에서 가장 위험한 건 "첫 화면은 맞고 누른 다음이 틀린" 경우다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const DATA = path.join(__dirname, '..', 'data');
const EXP = path.join(__dirname, '_backtest_expected.json');
const html = fs.readFileSync(path.join(DIST, 'backtest.html'), 'utf8');

const ids = new Set();
html.replace(/\bid="([^"]+)"/g, (_, v) => ids.add(v));
const metas = {};
html.replace(/<meta\s+name="([^"]+)"[\s\S]{0,400}?content="([^"]*)"/g, (_, n, c) => { metas[n] = c; });

// ── 리스너를 기억하는 최소 DOM ─────────────────────────────
const created = [];
function mkEl(tag, id) {
  const el = {
    tag, id: id || '', _html: '', textContent: '', className: '', value: '', checked: false,
    hidden: true, min: '', max: '', style: {}, dataset: {},
    clientWidth: 760, clientHeight: 330, offsetWidth: 160, offsetHeight: 70,
    _cls: new Set(), _on: {}, _kids: [],
    classList: {
      add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); },
      toggle(c, on) { if (on) el._cls.add(c); else el._cls.delete(c); },
      contains: (c) => el._cls.has(c),
    },
    addEventListener(t, fn) { (el._on[t] = el._on[t] || []).push(fn); },
    removeEventListener() {}, remove() {}, focus() {}, setAttribute() {},
    appendChild(c) { el._kids.push(c); return c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 760, height: 330, right: 760, bottom: 330 }),
    querySelector(sel) {
      if (sel === '.hitlayer') return el._kids.find((k) => k.className === 'hitlayer') || null;
      return mkEl('g');                      // g.hover / line / span 등
    },
    querySelectorAll(sel) {
      if (sel === 'circle') return Array.from({ length: 8 }, () => mkEl('circle'));
      return el._buttons || [];
    },
    closest: () => null,
    fire(t, ev) {
      const fns = el._on[t] || [];
      fns.forEach((fn) => fn(Object.assign({ target: el, preventDefault() {} }, ev || {})));
      return fns.length;
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    // 브라우저와 같게: innerHTML 을 새로 쓰면 자식(히트레이어 등)은 사라진다
    set(v) { el._html = String(v); el._kids = []; },
  });
  created.push(el);
  return el;
}

const els = new Map(), missing = [];
const get = (id) => {
  if (!els.has(id)) els.set(id, mkEl('div', id));
  return els.get(id);
};

/** html 의 <button data-...> 를 실제 버튼처럼 만들어 컨테이너에 심는다 */
function buttonsFrom(containerId, attr, key) {
  const m = new RegExp('id="' + containerId + '">([\\s\\S]*?)</div>').exec(html);
  const body = m ? m[1] : '';
  return [...body.matchAll(new RegExp('<button[^>]*' + attr + '="([^"]+)"', 'g'))].map((mm) => {
    const b = mkEl('button');
    b.dataset[key] = mm[1];
    b.closest = () => b;                     // e.target.closest('button[data-...]')
    return b;
  });
}

const doc = {
  documentElement: mkEl('html'),
  getElementById(id) {
    if (!ids.has(id) && id !== 'csvPick') { missing.push(id); return null; }
    return get(id);
  },
  querySelector(sel) {
    const m = /^meta\[name="([^"]+)"\]$/.exec(sel);
    if (m) return m[1] in metas ? { getAttribute: (a) => (a === 'content' ? metas[m[1]] : null) } : null;
    return null;
  },
  querySelectorAll: () => [],
  createElement: (t) => mkEl(t),
};

const csvText = {
  'SOXL_OHLC.csv': fs.readFileSync(path.join(DATA, 'SOXL_OHLC.csv'), 'utf8'),
  'SOXS_OHLC.csv': fs.readFileSync(path.join(DATA, 'SOXS_OHLC.csv'), 'utf8'),
  'qqq_regime.csv': fs.readFileSync(path.join(DATA, 'qqq_regime.csv'), 'utf8'),
};
const mem = {};
const sb = {
  console, document: doc,
  getComputedStyle: () => ({ getPropertyValue: () => '#2a78d6' }),
  localStorage: {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; },
  },
  FileReader: function () {},
  fetch: (u) => {
    const n = String(u).split('/').pop();
    return n in csvText
      ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(csvText[n]) })
      : Promise.reject(new Error('없는 파일 ' + n));
  },
  innerWidth: 1200, innerHeight: 900, addEventListener() {},
  Promise, setTimeout, clearTimeout,
  Array, Object, JSON, Math, Number, String, Boolean, Date, Error,
  isNaN, parseFloat, parseInt, isFinite,
};
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);

get('presets')._buttons = buttonsFrom('presets', 'data-preset', 'preset');
get('scaleSeg')._buttons = buttonsFrom('scaleSeg', 'data-scale', 'scale');

const exp = fs.existsSync(EXP) ? JSON.parse(fs.readFileSync(EXP, 'utf8')) : null;
if (!exp) console.log('  (참고) 기대값 파일이 없어 수치 대조는 건너뜁니다 — python verify/page_backtest.py');
const byName = {};
if (exp) exp.cases.forEach((c) => { byName[c.name] = c; });
const asPct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';

let fails = 0;
function check(ok, label, extra) {
  if (!ok) fails++;
  console.log(`  ${ok ? '[OK]  ' : '[실패]'} ${label}${extra ? ' — ' + extra : ''}`);
}
const H = (id) => get(id)._html;
const T = (id) => get(id).textContent;
/** 화면이 실제로 다시 그려졌는지 — 표·차트가 비어 있으면 실패 */
const drawn = () => H('statRow').length > 200 && H('yearRows').length > 50
  && H('cmpRows').length > 200 && H('eqChart').includes('<path');
/** 히어로 타일에 찍힌 퍼센트 */
const heroPct = () => (/([+-]\d+\.\d+)%/.exec(H('statRow')) || ['(없음)'])[0];

console.log('='.repeat(78));
console.log('백테스트 페이지 상호작용 검증');
console.log('='.repeat(78));

try {
  for (const f of ['spec.js', 'backtest.js', 'backtest-app.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIST, f), 'utf8'), sb, { filename: f });
  }
} catch (e) {
  fails++;
  console.log('  [실패] 로드 — ' + e.message);
  if (e.stack) console.log('        ' + e.stack.split('\n').slice(1, 3).join('\n        '));
}

// fetch → 렌더가 마이크로태스크로 이어진다
setTimeout(() => {
  const presets = get('presets')._buttons;
  const clickPreset = (key) => {
    const b = presets.find((x) => x.dataset.preset === key);
    if (!b) { fails++; console.log(`  [실패] ${key} 프리셋 버튼이 없습니다`); return false; }
    try { get('presets').fire('click', { target: b }); return true; }
    catch (e) { fails++; console.log(`  [실패] ${key} 클릭 예외 — ${e.message}`); return false; }
  };
  const setDates = (a, b) => {
    const f = get('fromDate'), t = get('toDate');
    f.value = a; t.value = b;
    try { f.fire('change', { target: f }); t.fire('change', { target: t }); return true; }
    catch (e) { fails++; console.log(`  [실패] ${a}~${b} 예외 — ${e.message}`); return false; }
  };
  const setAlloc = (v) => {
    const s = get('allocMode'); s.value = v;
    try { s.fire('change', { target: s }); return true; }
    catch (e) { fails++; console.log(`  [실패] 배분 ${v} 예외 — ${e.message}`); return false; }
  };

  console.log('\n1) 첫 화면');
  check(drawn(), '전체 구간 렌더', T('rangeTag') + ' · ' + heroPct());
  if (exp) {
    const c = byName['전체 · 동적 30:70'];
    check(H('statRow').includes(asPct(c.cagr)), `CAGR ${asPct(c.cagr)} (파이썬 값)`, heroPct());
  }

  console.log('\n2) 프리셋 클릭 — 누른 다음의 수치까지');
  ['2016', 'y10', 'y5', 'y3', 'y1', 'ytd', 'all'].forEach((key) => {
    if (!clickPreset(key)) return;
    let ok = drawn();
    let note = T('rangeTag') + ' · ' + heroPct();
    if (exp && key === '2016') {
      const c = byName['2016~ · 동적 30:70'];
      ok = ok && H('statRow').includes(asPct(c.cagr));
      note += ` (기대 ${asPct(c.cagr)})`;
    }
    if (exp && key === 'all') {
      const c = byName['전체 · 동적 30:70'];
      ok = ok && H('statRow').includes(asPct(c.cagr));
      note += ` (기대 ${asPct(c.cagr)})`;
    }
    check(ok, `프리셋 ${key}`, note);
  });

  console.log('\n3) 날짜 직접 입력 — 경계값 포함');
  if (setDates('2020-01-01', '2022-12-31')) {
    let ok = drawn() && T('rangeTag').indexOf('2020-01-02') === 0;
    let note = T('rangeTag') + ' · ' + heroPct();
    if (exp) {
      const c = byName['2020~2022 구간'];
      ok = ok && H('statRow').includes(asPct(c.cagr));
      note += ` (기대 ${asPct(c.cagr)})`;
    }
    check(ok, '휴장일 시작·종료 → 안쪽 거래일로 붙는다', note);
  }
  if (setDates('2026-09-04', '2026-09-04')) {
    check(T('rangeTag').includes('짧'), '시작=종료 → 거부 안내', T('rangeTag'));
  }
  if (setDates('2030-01-01', '2030-12-31')) {
    check(drawn(), '데이터 범위 밖 → 전체 구간으로 되돌아감', T('rangeTag'));
  }
  if (setDates('2026-08-03', '2026-09-04')) {
    // 1년 미만 구간은 CAGR 대신 총수익률을 앞세운다 (연 환산 과장 방지)
    check(H('statRow').indexOf('총수익률') >= 0 && H('statRow').indexOf('연 환산') > 0,
      '1년 미만 구간 → 총수익률을 히어로로', heroPct());
  }
  clickPreset('all');

  console.log('\n4) 배분 · SOXS 토글');
  const allocExp = { w20: '전체 · 고정 20:80', grid: '전체 · 그리드 단독' };
  ['w20', 'w30', 'grid', 'bo', 'dyn'].forEach((v) => {
    if (!setAlloc(v)) return;
    let ok = drawn(), note = T('perfTitle') + ' · ' + heroPct();
    if (exp && allocExp[v]) {
      const c = byName[allocExp[v]];
      ok = ok && H('statRow').includes(asPct(c.cagr));
      note += ` (기대 ${asPct(c.cagr)})`;
    }
    check(ok, `배분 ${v}`, note);
  });
  {
    const bos = get('bosOn');
    bos.checked = false;
    let err = null;
    try { bos.fire('change', { target: bos }); } catch (e) { err = e; }
    let ok = !err && drawn(), note = T('perfTitle') + ' · ' + heroPct();
    if (exp) {
      const c = byName['전체 · SOXS 없이'];
      ok = ok && H('statRow').includes(asPct(c.cagr));
      note += ` (기대 ${asPct(c.cagr)})`;
    }
    check(ok, 'SOXS 돌파 끄기', err ? err.message : note);
    bos.checked = true; bos.fire('change', { target: bos });
  }

  console.log('\n5) 비교군 · 축 토글');
  {
    const alt = get('cmpAlt'); alt.checked = true;
    let err = null;
    try { alt.fire('change', { target: alt }); } catch (e) { err = e; }
    const n = H('eqLegend').split('class="lg"').length - 1;
    check(!err && n === 4, '비교 구성 추가 → 범례 4줄', err ? err.message : n + '줄');

    const bh = get('cmpBH'); bh.checked = false;
    let err2 = null;
    try { bh.fire('change', { target: bh }); } catch (e) { err2 = e; }
    check(!err2 && H('eqLegend').split('class="lg"').length - 1 === 3,
      'Buy&Hold 끄기 → 범례 3줄', err2 ? err2.message : '');
    bh.checked = true; bh.fire('change', { target: bh });
  }
  get('scaleSeg')._buttons.forEach((b) => {
    let err = null;
    try { get('scaleSeg').fire('click', { target: b }); } catch (e) { err = e; }
    check(!err && H('eqChart').includes('<path'), `축 ${b.dataset.scale}`,
      err ? err.message : H('eqChart').length.toLocaleString() + '자');
  });

  console.log('\n6) 툴팁 (크로스헤어)');
  {
    const hits = created.filter((e) => e.className === 'hitlayer');
    check(hits.length > 0, '히트레이어 생성');
    if (hits.length) {
      const hit = hits[hits.length - 1];
      let err = null;
      try { hit.fire('mousemove', { clientX: 400, clientY: 300 }); } catch (e) { err = e; }
      const tip = get('tip');
      const txt = tip._html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      check(!err && /\d{4}-\d{2}-\d{2}/.test(tip._html) && tip._html.includes('$') && tip.hidden === false,
        '마우스 이동 → 날짜·금액 표시', err ? err.message : txt.slice(0, 64));
      let err2 = null;
      try { hit.fire('mouseleave', {}); } catch (e) { err2 = e; }
      check(!err2 && tip.hidden === true, '마우스 이탈 → 숨김', err2 ? err2.message : '');
    }
  }

  console.log('\n7) 버튼');
  {
    let err = null;
    try { get('reloadCsv').fire('click', {}); } catch (e) { err = e; }
    check(!err, '데이터 다시 받기', err ? err.message : '');
  }

  if (missing.length) {
    fails++;
    console.log('\n  [실패] backtest.html 에 없는 id: ' + [...new Set(missing)].join(', '));
  }

  console.log('\n' + '='.repeat(78));
  console.log(fails ? `실패 ${fails}건` : '통과 — 상호작용과 그 결과 수치가 모두 정상');
  process.exit(fails ? 1 : 0);
}, 80);
