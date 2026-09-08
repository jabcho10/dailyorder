/* 백테스트 페이지(dist/backtest.js) 검증.
 *
 *   python verify/page_backtest.py && node verify/page_backtest.js
 *
 * 페이지는 CSV 전체를 브라우저에서 다시 돌린다. 그 결과가 engine/strategy.py 의
 * 백테스트와 어긋나면, 페이지가 문서·주문과 다른 전략의 성과를 보여주게 된다.
 * 여기서 구간·설정을 바꿔가며 성과지표와 체결 통계를 통째로 대조한다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const DATA = path.join(__dirname, '..', 'data');
const EXP = path.join(__dirname, '_backtest_expected.json');

if (!fs.existsSync(EXP)) {
  console.error('기대값이 없습니다. 먼저 실행:  python verify/page_backtest.py');
  process.exit(1);
}

const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['spec.js', 'backtest.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIST, f), 'utf8'), sb);
}
const { BT } = sb.window;
const exp = JSON.parse(fs.readFileSync(EXP, 'utf8'));

const read = (f) => fs.readFileSync(path.join(DATA, f), 'utf8');
const B = BT.prepare({
  soxl: BT.parseBars(read('SOXL_OHLC.csv')),
  soxs: BT.parseBars(read('SOXS_OHLC.csv')),
  rsi: BT.parseRsi(read('qqq_regime.csv')),
});

console.log('='.repeat(84));
console.log('백테스트 페이지 vs 파이썬 백테스트 엔진');
console.log('='.repeat(84));
console.log(`  데이터 ${B[0].d} ~ ${B[B.length - 1].d}  (${B.length}봉)`);

let fails = 0;
const near = (a, b, tol = 1e-9) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
};
function eq(label, got, want, tol) {
  if (near(got, want, tol)) return;
  fails++;
  console.log(`  [불일치] ${label}\n      JS ${got}\n      PY ${want}`);
}

if (B.length !== exp.bars) {
  fails++;
  console.log(`  [불일치] 봉 수  JS ${B.length}  PY ${exp.bars}`);
}
if (B[0].d !== exp.first || B[B.length - 1].d !== exp.last) {
  fails++;
  console.log(`  [불일치] 구간  JS ${B[0].d}~${B[B.length - 1].d}  PY ${exp.first}~${exp.last}`);
}

console.log(`\n  ${'케이스'.padEnd(18)}${'CAGR'.padStart(9)}${'MDD'.padStart(9)}`
  + `${'Calmar'.padStart(8)}${'최종자산'.padStart(16)}${'판정'.padStart(7)}`);
console.log('  ' + '-'.repeat(80));

for (const c of exp.cases) {
  const before = fails;
  const r = BT.run(B, { i0: c.i0, i1: c.i1, wBo: c.w, bosOn: c.bos, init: exp.init });
  const st = BT.stats(r.eq, exp.init);

  eq(`${c.name} · 시작일`, st.from === c.from ? 0 : 1, 0);
  eq(`${c.name} · 종료일`, st.to === c.to ? 0 : 1, 0);
  eq(`${c.name} · 거래일수`, st.n, c.days);
  eq(`${c.name} · CAGR`, st.cagr, c.cagr, 1e-9);
  eq(`${c.name} · MDD`, st.mdd, c.mdd, 1e-9);
  eq(`${c.name} · Calmar`, st.calmar, c.calmar, 1e-9);
  eq(`${c.name} · maxUW`, st.maxuw, c.maxuw);
  eq(`${c.name} · 최종자산`, st.final, c.final, 1e-9);
  eq(`${c.name} · 최대노출`, r.maxGross, c.maxGross, 1e-9);

  // 연도별 수익률 / 연내 MDD
  const an = BT.annual(r.eq, exp.init), am = BT.annualMdd(r.eq);
  eq(`${c.name} · 연도 수`, an.length, c.annual.length);
  an.forEach((a, i) => {
    const w = c.annual[i];
    if (!w) return;
    eq(`${c.name} · ${a.year} 수익률`, a.ret, w.ret, 1e-9);
  });
  am.forEach((a, i) => {
    const w = c.annualMdd[i];
    if (!w) return;
    eq(`${c.name} · ${a.year} 연내MDD`, a.mdd, w.mdd, 1e-9);
  });

  // 체결 통계 — 건수는 정확히 같아야 하고 수익률 통계도 같아야 한다
  const ts = {
    soxl: BT.tradeStats(r.bo.trades.SOXL),
    soxs: BT.tradeStats(r.bo.trades.SOXS),
    grid: BT.tradeStats(r.grid.trades),
  };
  for (const k of ['soxl', 'soxs', 'grid']) {
    eq(`${c.name} · ${k} 건수`, ts[k].n, c[k].n);
    if (c[k].n) {
      eq(`${c.name} · ${k} 승률`, ts[k].win, c[k].win, 1e-12);
      eq(`${c.name} · ${k} 평균`, ts[k].avg, c[k].avg, 1e-9);
      eq(`${c.name} · ${k} 최고`, ts[k].best, c[k].best, 1e-9);
      eq(`${c.name} · ${k} 최저`, ts[k].worst, c[k].worst, 1e-9);
    }
  }

  const ok = fails === before;
  console.log('  ' + c.name.padEnd(18)
    + `${(st.cagr * 100).toFixed(2)}%`.padStart(9)
    + `${(st.mdd * 100).toFixed(2)}%`.padStart(9)
    + st.calmar.toFixed(2).padStart(8)
    + Math.round(st.final).toLocaleString('en-US').padStart(16)
    + (ok ? '일치' : '불일치').padStart(7));
}

// 매수 후 보유 비교군
const bh = BT.buyHold(B, exp.buyhold.i0, B.length - 1, exp.init);
const bst = BT.stats(bh, exp.init);
eq('Buy&Hold · CAGR', bst.cagr, exp.buyhold.cagr, 1e-9);
eq('Buy&Hold · MDD', bst.mdd, exp.buyhold.mdd, 1e-9);
eq('Buy&Hold · 최종자산', bst.final, exp.buyhold.final, 1e-9);
console.log('  ' + 'Buy&Hold'.padEnd(18)
  + `${(bst.cagr * 100).toFixed(2)}%`.padStart(9)
  + `${(bst.mdd * 100).toFixed(2)}%`.padStart(9)
  + bst.calmar.toFixed(2).padStart(8)
  + Math.round(bst.final).toLocaleString('en-US').padStart(16)
  + (near(bst.final, exp.buyhold.final, 1e-9) ? '일치' : '불일치').padStart(7));

// 구간 선택이 지표를 다시 계산하지 않는지 — 잘라낸 구간의 성과는
// 전체 이력으로 돌린 결과의 해당 구간과 같아야 한다 (미래참조·시드 차이 방지)
const full = BT.run(B, { init: exp.init });
const cut = BT.run(B, { i0: full.i0, i1: full.i1 - 5, init: exp.init });
for (let i = 0; i < cut.eq.length; i++) {
  if (!near(cut.eq[i][1], full.eq[i][1], 1e-12)) {
    fails++;
    console.log(`  [불일치] 구간을 줄였더니 ${cut.eq[i][0]} 자산이 달라짐 `
      + `(${cut.eq[i][1]} vs ${full.eq[i][1]})`);
    break;
  }
}

console.log('\n' + '='.repeat(84));
console.log(fails ? `실패 ${fails}건` : '통과 — 페이지 백테스트가 파이썬 엔진과 동일');
process.exit(fails ? 1 : 0);
