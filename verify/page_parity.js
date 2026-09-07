/* 주문 페이지(dist/spec.js) vs engine/strategy.py 대조.
 *
 *   python verify/page_parity.py && node verify/page_parity.js
 *
 * 두 구현이 같은 시나리오에서 같은 주문을 내는지 확인한다.
 * 페이지를 고칠 때마다 이 검사를 돌려 문서 스펙에서 떨어져 나가는 것을 막는다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const HERE = __dirname;
const DIST = path.join(HERE, '..', 'soxl-daily-orders-source', 'dist');
const EXP = path.join(HERE, '_parity_expected.json');

if (!fs.existsSync(EXP)) {
  console.error('기대값이 없습니다. 먼저 실행:  python verify/page_parity.py');
  process.exit(1);
}

// dist/data.js 와 dist/spec.js 를 브라우저처럼 같은 전역에 올린다
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST, 'data.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST, 'spec.js'), 'utf8'), sandbox);
const SEED = sandbox.window.SEED, SPEC = sandbox.window.SPEC;

const exp = JSON.parse(fs.readFileSync(EXP, 'utf8'));
const EPS = 1e-6;
let fails = 0, checks = 0;

function near(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}
function cmp(label, got, want) {
  checks++;
  const ok = typeof want === 'number' ? near(got, want) : got === want;
  if (!ok) { fails++; console.log(`      [불일치] ${label}: JS ${got}  vs  PY ${want}`); }
  return ok;
}

// 1) 파라미터 대조
console.log('='.repeat(84));
console.log('1. 파라미터 대조  spec.js  vs  strategy.py');
console.log('='.repeat(84));
const P = SPEC.P, pp = exp.params;
const pmap = {
  W_BASE: P.W_BASE, W_STRONG: P.W_STRONG, BO_K: P.BO_K, BOS_K: P.BOS_K,
  BOS_RSI: P.BOS_RSI, BOS_MAX_W: P.BOS_MAX_W, G1_DROP: P.G1_DROP, EPS: P.EPS,
  MAX_DAYS: P.MAX_DAYS, TP_TOP: P.TP.TOP, TP_BOTTOM: P.TP.BOTTOM,
};
Object.keys(pmap).forEach(k => cmp(k, pmap[k], pp[k]));
pp.W_TOP.forEach((v, i) => cmp(`W_TOP[${i}]`, P.W_TOP[i], v));
pp.W_BOTTOM.forEach((v, i) => cmp(`W_BOTTOM[${i}]`, P.W_BOTTOM[i], v));
console.log(`  파라미터 ${checks}개 대조  ${fails ? fails + '건 불일치' : '전부 일치'}`);

// 2) 데이터 기준일
console.log('\n' + '='.repeat(84));
console.log('2. 데이터 기준일');
console.log('='.repeat(84));
cmp('asOf', SEED.soxl[SEED.soxl.length - 1][0], exp.asOf);
cmp('rsi', SEED.qqq.rsi, exp.rsi);
console.log(`  SOXL ${SEED.soxl.length}봉 / SOXS ${SEED.soxs.length}봉  기준일 ${SEED.qqq.date}  RSI ${SEED.qqq.rsi}`);

// 3) 시나리오별 주문 대조
console.log('\n' + '='.repeat(84));
console.log('3. 시나리오별 주문 대조');
console.log('='.repeat(84));
exp.cases.forEach((c, n) => {
  const before = fails;
  const got = SPEC.computeOrders({
    soxl: SEED.soxl, soxs: SEED.soxs,
    rsi: c.input.regime === 'BOTTOM' ? 40 : 58.1151,   // 레짐만 맞추면 된다
    cash: c.input.cash,
    boHold: { ticker: c.input.boQty > 0 ? c.input.boTick : null, qty: c.input.boQty },
    lots: c.input.lots, lastRung: c.input.lastRung,
  });
  const w = c.expect;
  cmp('총자산', got.total, w.total);
  cmp('목표비중', got.targetW, w.targetW);
  cmp('정배열', got.strong, w.strong);
  cmp('돌파현금', got.boCash, w.boCash);
  cmp('그리드현금', got.gridCash, w.gridCash);

  if (w.breakout) {
    cmp('돌파.종목', got.breakout && got.breakout.ticker, w.breakout.ticker);
    cmp('돌파.감시가', got.breakout && got.breakout.watch, w.breakout.watch);
    cmp('돌파.지정가', got.breakout && got.breakout.limit, w.breakout.limit);
    cmp('돌파.투입한도', got.breakout && got.breakout.budget, w.breakout.budget);
    cmp('돌파.수량', got.breakout && got.breakout.qty, w.breakout.qty);
  } else cmp('돌파', got.breakout, null);

  if (w.gridEntry) {
    cmp('진입.칸', got.gridEntry && got.gridEntry.rung, w.gridEntry.rung);
    cmp('진입.비중', got.gridEntry && got.gridEntry.weight, w.gridEntry.weight);
    cmp('진입.지정가', got.gridEntry && got.gridEntry.limit, w.gridEntry.limit);
    cmp('진입.금액', got.gridEntry && got.gridEntry.amount, w.gridEntry.amount);
    cmp('진입.수량', got.gridEntry && got.gridEntry.qty, w.gridEntry.qty);
  } else cmp('진입', got.gridEntry, null);

  cmp('청산 건수', got.gridExits.length, w.gridExits.length);
  w.gridExits.forEach((e, i) => {
    const g = got.gridExits[i] || {};
    cmp(`청산[${i}].칸`, g.no, e.no);
    cmp(`청산[${i}].지정가`, g.orderLimit, e.limit);
    cmp(`청산[${i}].경과`, g.elapsed, e.elapsed);
    cmp(`청산[${i}].강제`, g.forced, e.forced);
  });

  const ok = fails === before;
  console.log(`  ${ok ? '[일치]' : '[불일치]'}  ${n + 1}. ${c.name}`);
});

console.log('\n' + '='.repeat(84));
console.log(`대조 ${checks}건 중 불일치 ${fails}건 — ${fails ? '실패' : '주문 페이지와 파이썬 엔진이 동일'}`);
process.exit(fails ? 1 : 0);
