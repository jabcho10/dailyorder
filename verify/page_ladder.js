/* 그리드 계획표(projectLadder) 검증.
 *
 *   node verify/page_ladder.js
 *
 * 계획표는 별도 규칙이 아니라 §5.3~5.5 를 앞으로 굴린 것이어야 한다.
 * 1번 칸이 실제 주문(computeOrders)과 한 푼도 다르지 않은지, 사다리 간격·
 * 비중·익절률·현금 제약이 문서와 맞는지 확인한다.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIST = path.join(__dirname, '..', 'soxl-daily-orders-source', 'dist');
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['data.js', 'spec.js']) vm.runInContext(fs.readFileSync(path.join(DIST, f), 'utf8'), sb);
const { SEED, SPEC } = sb.window, P = SPEC.P;

let fails = 0, checks = 0;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
function ok(label, cond, detail) {
  checks++;
  if (!cond) { fails++; console.log(`    [실패] ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('='.repeat(78));
console.log('그리드 계획표 검증');
console.log('='.repeat(78));

for (const regime of ['TOP', 'BOTTOM']) {
  const rsi = regime === 'TOP' ? 58.1151 : 40;
  const cash = 100000;
  const live = SPEC.computeOrders({
    soxl: SEED.soxl, soxs: SEED.soxs, rsi, cash, boHold: {}, lots: [], lastRung: 0,
  });
  const plan = SPEC.projectLadder({
    prevClose: live.prevClose, gridCash: live.gridCash, regime,
  });
  const r1 = plan.rows[0], W = regime === 'TOP' ? P.W_TOP : P.W_BOTTOM;

  console.log(`\n  ${regime} 레짐 · 그리드현금 $${live.gridCash.toLocaleString()}`);

  // 1) 1번 칸 = 실제 주문과 완전히 동일해야 한다
  ok('1번 칸 지정가 = 실주문', near(r1.limit, live.gridEntry.limit),
    `${r1.limit} vs ${live.gridEntry.limit}`);
  ok('1번 칸 수량 = 실주문', r1.qty === live.gridEntry.qty,
    `${r1.qty} vs ${live.gridEntry.qty}`);
  ok('1번 칸 금액 = 실주문', near(r1.amount, live.gridEntry.amount),
    `${r1.amount} vs ${live.gridEntry.amount}`);
  ok('1번 칸 비중 = 실주문', near(r1.weight, live.gridEntry.weight));

  // 2) 사다리 간격 (§5.3)
  ok('1번 칸 = 전일 종가 −0.5%', near(r1.limit, live.prevClose * (1 - P.G1_DROP)));
  for (let i = 1; i < plan.rows.length; i++) {
    const prev = plan.rows.slice(0, i).filter(x => x.qty > 0);
    if (!prev.length) continue;
    const lo = Math.min(...prev.map(x => x.limit));
    ok(`${i + 1}번 칸 = 최저 매수가 −0.75%`,
      near(plan.rows[i].limit, lo * (1 - P.EPS)),
      `${plan.rows[i].limit} vs ${lo * (1 - P.EPS)}`);
  }

  // 3) 비중·익절률 (§5.2, §5.5)
  plan.rows.forEach((r, i) => {
    ok(`${i + 1}번 비중`, near(r.weight, W[i]));
    ok(`${i + 1}번 익절률`, near(r.tp, P.TP[regime]));
    ok(`${i + 1}번 익절가`, near(r.tpPrice, r.limit * (1 + P.TP[regime])));
  });

  // 4) 현금 제약 — 누적 매수금액이 그리드 현금을 넘지 않아야 한다
  ok('누적 매수금액 ≤ 그리드현금', plan.totalSpend <= live.gridCash + 1e-6,
    `${plan.totalSpend} vs ${live.gridCash}`);
  ok('잔여현금 ≥ 0', plan.cashLeft >= -1e-6, String(plan.cashLeft));
  plan.rows.forEach(r => ok(`${r.no}번 잔여현금 ≥ 0`, r.cashAfter >= -1e-6));

  const f = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log('    칸  비중    지정가        수량      매수금액       익절가      예상손익     잔여현금');
  plan.rows.forEach(r => {
    console.log(`    ${r.no}  ${(r.weight * 100).toFixed(0).padStart(3)}%  ${f(r.limit).padStart(10)}`
      + `  ${String(r.qty).padStart(7)}주  ${f(r.spend).padStart(11)}  ${f(r.tpPrice).padStart(10)}`
      + `  ${(r.pnl >= 0 ? '+' : '') + f(r.pnl).padStart(9)}  ${f(r.cashAfter).padStart(11)}`
      + (r.cashBound ? '  <현금한도>' : ''));
  });
  console.log(`    합계: ${plan.filled}칸 ${plan.shares.toLocaleString()}주 · 투입 ${f(plan.totalSpend)}`
    + ` · 평단 ${f(plan.avgPrice)} · 최저칸 ${f(plan.lastLimit)} (${(plan.dropPct * 100).toFixed(2)}%)`
    + ` · 전량익절 시 ${(plan.totalPnl >= 0 ? '+' : '') + f(plan.totalPnl)}`);
}

// 5) 보유 칸이 있을 때 — 계획표의 '다음 칸' 이 실제 주문과 같아야 한다
console.log('\n  보유 칸이 있는 경우');
[
  { name: '1~3번 보유 · 다음 4번', lots: [
      { no: 1, px: 122.43, qty: 104, regime: 'TOP' },
      { no: 2, px: 121.52, qty: 131, regime: 'TOP' },
      { no: 3, px: 120.61, qty: 158, regime: 'TOP' }], start: 4, cash: 32245 },
  { name: '1번만 보유 · 다음 2번', lots: [
      { no: 1, px: 118.00, qty: 90, regime: 'BOTTOM' }], start: 2, cash: 60000 },
  { name: '중간 청산 (1,2 보유) · 다음 5번', lots: [
      { no: 1, px: 130.00, qty: 60, regime: 'TOP' },
      { no: 2, px: 126.00, qty: 70, regime: 'TOP' }], start: 5, cash: 40000 },
].forEach(function (t) {
  const live = SPEC.computeOrders({
    soxl: SEED.soxl, soxs: SEED.soxs, rsi: 58.1151, cash: t.cash,
    boHold: {}, lots: t.lots.map(l => Object.assign({ date: SEED.soxl.at(-3)[0] }, l)),
    lastRung: t.start - 1,
  });
  const plan = SPEC.projectLadder({
    prevClose: live.prevClose, gridCash: live.gridCash, regime: 'TOP',
    lots: t.lots, startRung: t.start,
  });
  const row = plan.rows[t.start - 1];
  console.log(`    ${t.name}`);
  console.log(`      실주문 ${live.gridEntry.rung}번 $${live.gridEntry.limit.toFixed(2)} ${live.gridEntry.qty}주`
    + `  |  계획표 ${row.no}번 $${row.limit.toFixed(2)} ${row.qty}주`);
  ok(`${t.name} · 칸번호`, row.no === live.gridEntry.rung);
  ok(`${t.name} · 지정가`, near(row.limit, live.gridEntry.limit),
    `${row.limit} vs ${live.gridEntry.limit}`);
  ok(`${t.name} · 수량`, row.qty === live.gridEntry.qty,
    `${row.qty} vs ${live.gridEntry.qty}`);
  ok(`${t.name} · 금액`, near(row.amount, live.gridEntry.amount));
  ok(`${t.name} · status=next`, row.status === 'next');
  // 보유 칸은 실제 매수가·수량 그대로
  t.lots.forEach(function (l) {
    const r = plan.rows[l.no - 1];
    ok(`${t.name} · ${l.no}번 보유표시`, r.status === 'held' && near(r.limit, l.px) && r.qty === l.qty);
    ok(`${t.name} · ${l.no}번 익절률은 매수 당시 레짐`, near(r.tp, P.TP[l.regime]));
  });
  // 건너뛴 칸은 재매수 대상이 아니어야 한다
  for (let n = 1; n < t.start; n++) {
    if (t.lots.some(l => l.no === n)) continue;
    ok(`${t.name} · ${n}번은 지나간 칸`, plan.rows[n - 1].status === 'done',
      plan.rows[n - 1].status);
  }
  // 신규 투입은 남은 현금을 넘지 않아야 한다
  const newSpend = plan.rows.filter(r => r.status === 'next' || r.status === 'plan')
    .reduce((s, r) => s + r.spend, 0);
  ok(`${t.name} · 신규 투입 ≤ 그리드현금`, newSpend <= live.gridCash + 1e-6,
    `${newSpend} vs ${live.gridCash}`);
});

// 6) 사용자 수정이 아래 칸으로 전파되는지
console.log('\n  수정 반영 검사');
const base = SPEC.projectLadder({ prevClose: 100, gridCash: 100000, regime: 'TOP' });
const edited = SPEC.projectLadder({
  prevClose: 100, gridCash: 100000, regime: 'TOP',
  overrides: { 1: { limit: 90 } },
});
ok('1번 지정가 수정 반영', near(edited.rows[0].limit, 90));
ok('2번 칸이 수정값을 따라감', near(edited.rows[1].limit, 90 * (1 - P.EPS)),
  `${edited.rows[1].limit} vs ${90 * (1 - P.EPS)}`);
ok('수정 전과 달라짐', !near(base.rows[1].limit, edited.rows[1].limit));
const qtyEdit = SPEC.projectLadder({
  prevClose: 100, gridCash: 100000, regime: 'TOP',
  overrides: { 1: { qty: 10 } },
});
ok('수량 수정 반영', qtyEdit.rows[0].qty === 10);
ok('수량 수정이 잔여현금에 반영', near(qtyEdit.rows[0].cashAfter, 100000 - 10 * qtyEdit.rows[0].limit * 1.001));
ok('수량 수정이 총 투입금액을 줄임', qtyEdit.totalSpend < base.totalSpend);
ok('수량 수정이 잔여현금을 늘림', qtyEdit.rows[0].cashAfter > base.rows[0].cashAfter);
// §5.4 는 잔여현금이 아니라 "그리드 자산 × 비중" 으로 목표금액을 잡는다.
// 한 칸을 적게 사도 (현금↑ + 보유평가↓) 가 상쇄되어 다음 칸 예산은 거의 그대로다.
ok('수량 수정이 다음 칸 지정가를 바꾸지 않음', near(qtyEdit.rows[1].limit, base.rows[1].limit));
ok('다음 칸 목표금액이 크게 흔들리지 않음',
  Math.abs(qtyEdit.rows[1].target / base.rows[1].target - 1) < 0.01,
  `${qtyEdit.rows[1].target} vs ${base.rows[1].target}`);

console.log('\n' + '='.repeat(78));
console.log(`검사 ${checks}건 중 실패 ${fails}건 — ${fails ? '실패' : '계획표가 문서 규칙과 일치'}`);
process.exit(fails ? 1 : 0);
