/* 하루치 정산(SPEC.settleDay) 검증.
 *
 *   python verify/page_settle.py && node verify/page_settle.js
 *
 * settleDay 를 하루씩 이어 돌린 결과가 engine/strategy.py 의 백테스트와
 * 같은 체결을 내는지 대조한다. 페이지가 "어제 이렇게 체결됐어야 한다" 고
 * 제안하는 내용이 백테스트와 어긋나면 안 되기 때문이다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const EXP = path.join(__dirname, '_settle_expected.json');

if (!fs.existsSync(EXP)) {
  console.error('기대값이 없습니다. 먼저 실행:  python verify/page_settle.py');
  process.exit(1);
}
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['data.js', 'spec.js']) vm.runInContext(fs.readFileSync(path.join(DIST, f), 'utf8'), sb);
const { SEED, SPEC } = sb.window;
const exp = JSON.parse(fs.readFileSync(EXP, 'utf8'));

console.log('='.repeat(80));
console.log('하루치 정산 vs 백테스트 엔진');
console.log('='.repeat(80));
console.log(`  구간 ${exp.from} ~ ${exp.to}  (${exp.days}일)`);

// 백테스트와 같은 상태에서 출발해 하루씩 정산해 나간다
let state = {
  cash: exp.start.cash,
  lots: exp.start.lots.map((l) => ({ ...l })),
  lastRung: exp.start.lastRung,
  boHold: { ticker: exp.start.boTicker, qty: exp.start.boQty },
};

const norm = (s) => s.split(' ')[0];
let fails = 0, checks = 0, matched = 0;
const got = [];

for (let i = 0; i < exp.steps.length; i++) {
  const step = exp.steps[i];
  const upto = SEED.soxl.findIndex((r) => r[0] === step.date);
  if (upto < 0) { fails++; console.log(`  [실패] ${step.date} 봉을 찾을 수 없습니다`); break; }
  const sIdx = SEED.soxs.findIndex((r) => r[0] === step.date);

  const r = SPEC.settleDay({
    soxl: SEED.soxl.slice(0, upto + 1),
    soxs: SEED.soxs.slice(0, sIdx + 1),
    rsi: step.rsi,
    cash: state.cash, lots: state.lots, lastRung: state.lastRung, boHold: state.boHold,
  });
  if (!r.ok) { fails++; console.log(`  [실패] ${step.date}: ${r.reason}`); break; }

  // 체결 이벤트를 백테스트와 대조
  const mine = r.events.filter((e) => e.sign !== 0)
    .map((e) => `${e.kind}:${e.qty}@${e.price.toFixed(4)}`).sort();
  const want = step.fills.map((f) => `${f.kind}:${f.qty}@${f.price.toFixed(4)}`).sort();
  checks++;
  if (JSON.stringify(mine) !== JSON.stringify(want)) {
    fails++;
    if (fails <= 5) {
      console.log(`  [불일치] ${step.date}`);
      console.log(`      JS  ${mine.join(' | ') || '(없음)'}`);
      console.log(`      PY  ${want.join(' | ') || '(없음)'}`);
    }
  } else matched++;

  got.push({ date: step.date, n: mine.length });
  state = r.next;
}

console.log(`\n  일자 대조 ${checks}일 중 일치 ${matched}일, 불일치 ${fails}일`);
const totalFills = got.reduce((s, x) => s + x.n, 0);
console.log(`  정산된 체결 ${totalFills}건`);
console.log(`\n  최종 상태  현금 $${state.cash.toFixed(2)}  보유 ${state.lots.length}칸  `
  + `마지막칸 ${state.lastRung}  돌파 ${state.boHold.qty ? state.boHold.ticker + ' ' + state.boHold.qty + '주' : '없음'}`);
console.log(`  백테스트   현금 $${exp.end.cash.toFixed(2)}  보유 ${exp.end.lots.length}칸  `
  + `마지막칸 ${exp.end.lastRung}  돌파 ${exp.end.boQty ? exp.end.boTicker + ' ' + exp.end.boQty + '주' : '없음'}`);

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
if (!near(state.cash, exp.end.cash)) { fails++; console.log('  [실패] 최종 현금 불일치'); }
if (state.lots.length !== exp.end.lots.length) { fails++; console.log('  [실패] 최종 보유 칸 수 불일치'); }
else state.lots.forEach((l, i) => {
  const w = exp.end.lots[i];
  if (l.no !== w.no || !near(l.px, w.px) || !near(l.qty, w.qty) || l.date !== w.date) {
    fails++; console.log(`  [실패] 보유 칸 ${i}: JS ${JSON.stringify(l)} PY ${JSON.stringify(w)}`);
  }
});
if (state.lastRung !== exp.end.lastRung) { fails++; console.log('  [실패] lastRung 불일치'); }

console.log('\n' + '='.repeat(80));
console.log(fails ? `실패 ${fails}건` : '통과 — 정산 결과가 백테스트와 동일');
process.exit(fails ? 1 : 0);
