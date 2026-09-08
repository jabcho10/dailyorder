/* 주문 페이지 UI.
 * 주문 계산은 전부 spec.js 의 SPEC.computeOrders() 가 한다. 이 파일에는 규칙이 없다.
 * 규칙을 바꿔야 하면 spec.js 를 고치고 verify/page_parity.js 를 돌릴 것.
 */
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var P = SPEC.P;

  // ── 상태 ────────────────────────────────────────────────
  var LS_DATA = 'soxl-order-data-v2', LS_IN = 'soxl-order-input-v2';
  var blankLots = function () {
    return Array.from({ length: P.N_GRID }, function () {
      return { held: false, px: '', qty: '', date: '', regime: 'TOP' };
    });
  };
  var defaultInput = function () {
    return {
      cash: 100000, boTick: '', boQty: 0, lots: blankLots(), lastRung: 0, tick: '0.01', maxTicks: 10,
      settledThrough: '',
      plan: { date: '', regime: 'AUTO', cash: '', edits: {} }
    };
  };

  var data = load(LS_DATA) || clone(window.SEED);
  var input = merge(defaultInput(), load(LS_IN));
  if (!Array.isArray(input.lots) || input.lots.length !== P.N_GRID) input.lots = blankLots();
  if (!input.plan || typeof input.plan !== 'object') input.plan = defaultInput().plan;
  if (!input.plan.edits || typeof input.plan.edits !== 'object') input.plan.edits = {};

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 시크릿 모드 */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    if (!over) return base;
    Object.keys(over).forEach(function (k) { if (over[k] !== undefined) base[k] = over[k]; });
    return base;
  }

  // ── 표시 헬퍼 ───────────────────────────────────────────
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    return Number.isFinite(n) ? '$' + n.toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  };
  var qty = function (n) { return Number.isFinite(n) ? n.toLocaleString('en-US') + '주' : '—'; };
  var pct = function (n) { return Number.isFinite(n) ? (n * 100).toFixed(n * 100 % 1 ? 2 : 0) + '%' : '—'; };
  var badge = function (t, c) { return '<span class="st ' + c + '">' + esc(t) + '</span>'; };

  // 자동감시주문의 "주문가격 = 감시가 + X틱" 입력용.
  // 밴드는 비율(0.1%)이고 틱은 절대값이라 X 는 가격대마다 달라진다.
  // 올림을 쓴다 — 스펙의 지정가보다 낮아져 백테스트가 잡은 체결을 놓치는 쪽을 피한다.
  function ticksFor(watch, limit) {
    var t = parseFloat(input.tick) || 0.01;
    var max = Math.max(1, parseInt(input.maxTicks, 10) || 10);
    var raw = (limit - watch) / t;
    var want = Math.ceil(raw - 1e-9);          // 올림 — 스펙 지정가보다 낮아지지 않게
    var n = Math.min(want, max);               // 시스템 입력 상한
    var price = watch + n * t;
    return {
      tick: t, raw: raw, want: want, n: n, max: max,
      capped: want > max, price: price,
      band: watch > 0 ? price / watch - 1 : 0
    };
  }

  // ── 렌더 ────────────────────────────────────────────────
  function render() {
    var lots = input.lots
      .map(function (h, i) {
        return { no: i + 1, px: parseFloat(h.px), qty: parseFloat(h.qty), date: h.date, regime: h.regime, held: h.held };
      })
      .filter(function (h) { return h.held && h.px > 0 && h.qty > 0; });

    // 전량 청산이면 사이클 리셋 (§5.7)
    if (lots.length === 0 && Number(input.lastRung) !== 0) { input.lastRung = 0; $('lastRung').value = 0; }

    var o = SPEC.computeOrders({
      soxl: data.soxl, soxs: data.soxs, rsi: data.qqq && data.qqq.rsi,
      cash: Number(input.cash) || 0,
      boHold: { ticker: input.boTick || null, qty: Number(input.boQty) || 0 },
      lots: lots, lastRung: Number(input.lastRung) || 0
    });
    if (o.error) { $('dataState').textContent = o.error; return; }

    $('asOf').textContent = o.asOf;
    $('nextDay').textContent = o.asOf + ' 다음 거래일';

    // 01 필터
    var rsiOk = Number.isFinite(o.rsi);
    $('rsiValue').textContent = rsiOk ? o.rsi.toFixed(2) : '—';
    $('regimePill').textContent = o.regime || '—';
    $('regimePill').className = 'pill ' + (o.regime === 'BOTTOM' ? 'warn' : 'good');
    $('rsiBar').style.width = rsiOk ? Math.max(0, Math.min(100, o.rsi)) + '%' : '0';
    $('regimeReason').innerHTML = rsiOk
      ? '확정 주차 <b>' + esc(data.qqq.weekEnd) + '</b> · 그리드 익절 '
        + (o.regime === 'BOTTOM' ? '+1.0%' : '+2.5%')
        + ' · SOXS 게이트 ' + (o.rsi <= P.BOS_RSI ? '통과 (≤45)' : '미달 (>45)')
      : 'QQQ 주봉 RSI 가 없습니다. qqq_regime.csv 를 불러오세요.';

    $('closeValue').textContent = '종가 ' + money(o.prevClose);
    $('ma50Value').textContent = money(o.ma50);
    $('ma200Value').textContent = money(o.ma200);
    $('allocText').textContent = o.strong ? '돌파 30% : 그리드 70%' : '돌파 20% : 그리드 80%';
    $('maPill').textContent = !o.maReady ? '계산 대기' : o.strong ? '정배열' : '정배열 아님';
    $('maPill').className = 'pill ' + (!o.maReady ? '' : o.strong ? 'good' : 'warn');
    $('maReason').textContent = !o.maReady
      ? 'MA200 계산에 200거래일이 필요합니다. 현재 ' + data.soxl.length + '봉.'
      : o.strong ? '종가 > MA50 > MA200 · 강한 상승장' : '정배열 조건 불충족 · 기본 배분';
    $('maCard').className = 'card ' + (o.maReady ? (o.strong ? 'good' : 'warn') : '');

    $('dirText').textContent = o.direction ? o.direction + ' 돌파' : '주문 없음';
    $('dirPill').textContent = o.direction || '관망';
    $('dirPill').className = 'pill ' + (o.direction ? 'good' : 'warn');
    $('dirReason').textContent = o.direction === 'SOXL'
      ? '전일 종가가 MA200 위입니다. SOXL 감시주문만 제출합니다.'
      : o.direction === 'SOXS'
        ? '전일 종가가 MA200 이하이고 QQQ 주봉 RSI 가 45 이하입니다. SOXS 만 제출합니다.'
        : (o.breakoutReason || '—');
    $('dirCard').className = 'card ' + (o.direction ? 'good' : 'warn');
    perm('permSoxl', o.soxlAllowed); perm('permSoxs', o.soxsAllowed);
    perm('permGrid', !!o.gridEntry || o.gridExits.length > 0);

    // 02 리밸런싱
    var moved = o.rebalance.toBreakout - (Number(input.cash) || 0) + 0;
    $('rebalBox').innerHTML =
      '<div class="rb"><span>총자산</span><b>' + money(o.total) + '</b><small>현금 + 그리드 보유평가(전일 종가)</small></div>'
      + '<div class="rb"><span>목표 배분</span><b>' + o.rebalance.label + '</b><small>'
      + (o.strong ? '전일 종가 > MA50 > MA200' : '정배열 아님') + '</small></div>'
      + '<div class="rb"><span>돌파 슬리브 현금</span><b>' + money(o.boCash) + '</b><small>돌파 주문 재원</small></div>'
      + '<div class="rb"><span>그리드 현금</span><b>' + money(o.gridCash) + '</b><small>그리드 주문 재원</small></div>'
      + (o.liquidate
        ? '<div class="rb alert"><span>먼저 청산</span><b>' + esc(o.liquidate.ticker) + ' ' + qty(o.liquidate.qty)
          + ' MOO 매도</b><small>예상 대금 ' + money(o.liquidate.estimate) + ' (전일 종가 기준 추정)</small></div>'
        : '')
      + (o.gridStock > 0
        ? '<div class="rb"><span>그리드 보유주식</span><b>' + money(o.gridStock)
          + '</b><small>리밸런싱을 위해 매도하지 않음 (§2)</small></div>' : '');

    // 03 돌파
    $('boTag').textContent = o.direction ? o.direction + ' · k=' + (o.direction === 'SOXL' ? P.BO_K : P.BOS_K) : '주문 없음';
    if (o.breakout) {
      var b = o.breakout, r = b.ref;
      $('boFormula').innerHTML =
        fx('감시가 T', money(b.watch), '전일 종가 ' + money(r.c) + ' + ' + b.k + ' × 변동폭 ' + money(r.h - r.l))
        + fx('지정가 L', money(b.limit), 'T × 1.001 · 갭 추격 차단')
        + (function () {
            var tk = ticksFor(b.watch, b.limit);
            return fx('감시가 대비', '+' + tk.n + '틱' + (tk.capped ? ' (상한)' : ''),
              tk.capped
                ? '스펙은 ' + tk.want + '틱이지만 입력 상한 ' + tk.max + '틱 · 주문가 ' + money(tk.price)
                  + ' · 실효 밴드 ' + (tk.band * 100).toFixed(3) + '%'
                : '틱 $' + tk.tick + ' · ' + tk.raw.toFixed(2) + '틱 → 올림 · 주문가 ' + money(tk.price));
          })()
        + fx('주문 수량', qty(b.qty), '투입한도 ' + money(b.budget) + ' ÷ (L × 1.001), 정수 내림')
        + (b.capped ? fx('20% 상한 적용', money(b.cap), '전체자산의 20% 로 SOXS 투입을 제한 (§4.3)') : '');
      $('boRows').innerHTML =
        '<tr>' + '<td><b>' + esc(b.ticker) + '</b></td><td>' + badge('STOP-LIMIT 매수', 'ready') + '</td>'
        + '<td class="num">' + money(b.watch) + '</td><td class="num">' + money(b.limit) + '</td>'
        + '<td class="num">' + qty(b.qty) + '</td>'
        + '<td class="cond">고가 ≥ T <b>그리고</b> (시가 ≤ L <b>또는</b> 저가 ≤ L)</td></tr>'
        + '<tr class="dim"><td>' + esc(b.ticker) + '</td><td>' + badge('MOO 매도', 'sell') + '</td>'
        + '<td class="num">—</td><td class="num">다음 거래일 시가</td><td class="num">보유 전량</td>'
        + '<td class="cond">체결 시 손익과 무관하게 다음 거래일 시가 청산 (§3.5). '
        + '<b>LOO 가 아니라 MOO</b> — LOO 는 갭 하락 시 미체결로 남는다.</td></tr>';
      $('boNote').innerHTML = b.ticker === 'SOXS'
        ? '기준봉 ' + esc(r.date) + ' SOXS 고 ' + money(r.h) + ' / 저 ' + money(r.l) + ' / 종 ' + money(r.c)
          + ' · <b>SOXS 조정가 주의</b>: 과거 역분할이 반영된 계열이므로 최근 구간만 현재 호가와 일치합니다 (§11-4).'
        : '기준봉 ' + esc(r.date) + ' SOXL 고 ' + money(r.h) + ' / 저 ' + money(r.l) + ' / 종 ' + money(r.c)
          + ' · 갭 상승으로 지정가보다 높게 출발한 뒤 되돌아오지 않으면 미체결입니다 (§3.4).';
    } else {
      $('boFormula').innerHTML = '';
      $('boRows').innerHTML = '<tr><td colspan="6" class="empty">' + esc(o.breakoutReason || '주문 없음') + '</td></tr>';
      $('boNote').textContent = '';
    }

    // 04 그리드
    $('gridTag').textContent = o.regime ? o.regime + ' 레짐 · 익절 ' + pct(P.TP[o.regime]) : '—';
    var minPx = lots.reduce(function (m, x) { return Math.min(m, x.px); }, Infinity);
    $('gridFormula').innerHTML =
      fx('레짐', o.regime || '—', 'QQQ 주봉 RSI ' + (Number.isFinite(o.rsi) ? o.rsi.toFixed(2) : '—') + ' · 50 이하 BOTTOM')
      + fx('사이클 상태', lots.length === 0 ? '리셋 · 1번 칸부터' : lots.length + '칸 보유 · 마지막 매수 ' + input.lastRung + '번',
        lots.length === 0 ? '전량 청산됨 (§5.7)' : '최저 매수가 ' + money(minPx))
      + fx('그리드 자산', money(o.gridCash + o.gridStock), '현금 ' + money(o.gridCash) + ' + 보유 ' + money(o.gridStock));

    if (o.gridEntry) {
      var g = o.gridEntry;
      $('gridEntryRows').innerHTML =
        '<tr><td><b>' + g.rung + '번</b></td><td>' + esc(g.regime) + '</td><td class="num">' + pct(g.weight) + '</td>'
        + '<td>' + badge('LOC 매수', g.qty > 0 ? 'ready' : 'off') + '</td>'
        + '<td class="num">' + money(g.limit) + '</td>'
        + '<td class="num">' + money(g.amount) + (g.cashBound ? ' <em>현금한도</em>' : '') + '</td>'
        + '<td class="num">' + qty(g.qty) + '</td>'
        + '<td class="cond">당일 종가 ≤ ' + money(g.limit) + ' 이면 종가 체결'
        + (g.rung === 1 ? ' · 전일 종가 −0.5%' : ' · 최저 매수가 −0.75%') + '</td></tr>';
    } else {
      $('gridEntryRows').innerHTML = '<tr><td colspan="8" class="empty">'
        + esc(o.gridEntryReason || '신규 진입 없음') + '</td></tr>';
    }

    renderSettle();
    var fill = SPEC.lastFill({ soxl: data.soxl, soxs: data.soxs, rsi: data.qqq && data.qqq.rsi });
    renderFill(fill);
    renderToday(o, fill);
    renderPlan(o, lots);

    $('gridExitRows').innerHTML = o.gridExits.length ? o.gridExits.map(function (x) {
      return '<tr class="' + (x.forced ? 'forced' : '') + '">'
        + '<td><b>' + x.no + '번</b></td><td class="num">' + money(x.px) + '</td><td class="num">' + qty(x.qty) + '</td>'
        + '<td>' + esc(x.regime) + ' <small>+' + pct(x.tp) + '</small></td>'
        + '<td>' + badge(x.forced ? 'MOC 매도' : 'LOC 매도', x.forced ? 'force' : 'sell') + '</td>'
        + '<td class="num">' + (x.orderLimit == null ? '종가' : money(x.orderLimit)) + '</td>'
        + '<td class="num">' + (x.elapsed == null ? '?' : x.elapsed + '/' + P.MAX_DAYS) + '</td>'
        + '<td class="num">' + esc(x.dueDate) + (x.dueExact ? '' : ' <em>추정</em>')
        + (x.unknownDate ? ' <em>매수일 확인</em>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">보유 중인 칸이 없습니다.</td></tr>';

    // 05 체크리스트
    $('checklist').innerHTML = [
      ['장 시작 전', [
        o.liquidate ? '<b>' + esc(o.liquidate.ticker) + ' ' + qty(o.liquidate.qty) + '</b> 를 시가(MOO)에 전량 매도한다.'
          : '전일 돌파 보유분 없음 — 청산할 것이 없다.',
        '전일 종가 ' + money(o.prevClose) + ' / MA50 ' + money(o.ma50) + ' / MA200 ' + money(o.ma200)
          + ' → 목표 <b>' + o.rebalance.label + '</b>.',
        '현금만 이동해 돌파 <b>' + money(o.boCash) + '</b> / 그리드 <b>' + money(o.gridCash)
          + '</b> 로 맞춘다. 그리드 보유주식은 팔지 않는다.',
        o.breakout ? '<b>' + esc(o.breakout.ticker) + '</b> 감시가 ' + money(o.breakout.watch)
          + ' · 지정가 ' + money(o.breakout.limit) + ' · ' + qty(o.breakout.qty) + ' 자동감시주문을 낸다.'
          : '돌파 주문 없음 — ' + esc(o.breakoutReason || ''),
        o.gridEntry && o.gridEntry.qty > 0
          ? '그리드 ' + o.gridEntry.rung + '번 칸 LOC 매수 ' + money(o.gridEntry.limit) + ' · ' + qty(o.gridEntry.qty) + ' 를 준비한다.'
          : '그리드 신규 매수 없음.'
      ]],
      ['장중 · 마감', [
        o.breakout ? esc(o.breakout.ticker) + ' 스톱-리밋 체결 여부를 확인한다. 갭이 지정가를 넘으면 미체결로 둔다.'
          : '돌파 감시 없음.',
        o.gridExits.length ? '보유 칸의 익절 LOC / 강제청산 MOC 를 실행한다. 같은 날 둘 다 충족되면 <b>익절</b>로 기록한다 (§5.6).'
          : '청산할 보유 칸 없음.',
        '조건을 만족하면 그리드 신규 LOC 매수를 <b>한 건만</b> 실행한다.',
        '전 칸이 청산되면 다음 사이클을 1번 칸부터 시작한다.'
      ]]
    ].map(function (blk) {
      return '<div class="ck"><h4>' + blk[0] + '</h4><ol>'
        + blk[1].map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol></div>';
    }).join('');

    // 06 규칙 (spec.js 파라미터에서 직접 생성)
    $('rulesGrid').innerHTML = [
      ['배분', ['전일 종가 > MA' + P.MA_FAST + ' > MA' + P.MA_SLOW + ' → 돌파 ' + pct(P.W_STRONG) + ' / 그리드 ' + pct(1 - P.W_STRONG),
        '그 외 → 돌파 ' + pct(P.W_BASE) + ' / 그리드 ' + pct(1 - P.W_BASE),
        '돌파 청산 후 현금만 이동, 그리드 보유주식은 매도하지 않음',
        '총노출 100% 이하 · 수수료 편도 ' + pct(P.FEE)]],
      ['SOXL 돌파', ['활성: 전일 종가 > MA' + P.MA_LEN,
        '감시가 = 전일 종가 + ' + P.BO_K + ' × 전일 변동폭',
        '지정가 = 감시가 × ' + (1 + P.BO_BAND),
        '수량 = 가용현금 ÷ (지정가 × 1.001), 정수 내림',
        '다음 거래일 시가 MOO 전량 청산']],
      ['SOXS 돌파', ['활성: 전일 SOXL 종가 ≤ MA' + P.MA_LEN + ' 그리고 QQQ 주봉 RSI ≤ ' + P.BOS_RSI,
        '감시가 = 전일 SOXS 종가 + ' + P.BOS_K + ' × 전일 변동폭',
        '투입 상한 = 전체 자산의 ' + pct(P.BOS_MAX_W),
        'SOXL 과 동시에 주문하지 않음',
        '다음 거래일 시가 MOO 전량 청산']],
      ['그리드', ['7칸 · TOP ' + P.W_TOP.map(function (w) { return pct(w); }).join(' / '),
        'BOTTOM ' + P.W_BOTTOM.map(function (w) { return pct(w); }).join(' / '),
        '1번 칸 = 전일 종가 × ' + (1 - P.G1_DROP) + ' · 2~7번 = 최저 매수가 × ' + (1 - P.EPS),
        '익절 TOP +' + pct(P.TP.TOP) + ' / BOTTOM +' + pct(P.TP.BOTTOM) + ' (매수 당시 레짐 유지)',
        '매수 후 ' + P.MAX_DAYS + '거래일째 종가 MOC 강제청산',
        '당일 매도대금은 당일 매수 재원으로 쓰지 않음']]
    ].map(function (c, i) {
      return '<article class="rule"><span class="no">0' + (i + 1) + '</span><h3>' + c[0] + '</h3><ul>'
        + c[1].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></article>';
    }).join('');

    renderFresh();
    store(LS_IN, input);
  }

  // ── 오늘 주문 (맨 위 요약) ──────────────────────────────
  // 아침에 폰으로 보는 화면. 실제로 넣을 주문만 매수/매도로 나눠 보여준다.
  // MOO·MOC 는 가격이 정해지지 않으므로 금액은 추정으로 표시한다.
  function renderToday(o, fill) {
    var buys = [], sells = [];

    // 1) 전일 돌파분 시가 청산 (§6-1)
    // 체결은 어제 봉으로 판정된다. 수량만 사용자가 넣는다.
    if (fill && fill.filled && !o.liquidate) {
      sells.push({
        name: fill.direction + ' 돌파 청산',
        sub: '어제 ' + money(fill.price) + ' 체결 확인됨 · 보유 수량을 입력하세요',
        price: '시가', qty: NaN, amount: NaN, est: true, need: true
      });
    }
    if (o.liquidate) {
      var lq = o.liquidate;
      sells.push({
        name: lq.ticker + ' 돌파 청산',
        sub: '장 시작 · MOO 전량 매도',
        price: '시가', qty: lq.qty, amount: lq.estimate, est: true
      });
    }

    // 2) 돌파 감시주문 (§3, §4)
    if (o.breakout && o.breakout.qty > 0) {
      var b = o.breakout;
      buys.push({
        name: b.ticker + ' 돌파',
        sub: (function () {
          var tk = ticksFor(b.watch, b.limit);
          return '장 시작 · 자동감시 ' + money(b.watch) + ' → 지정가 매수 +' + tk.n + '틱'
            + (tk.capped ? ' (상한 · 실효 ' + (tk.band * 100).toFixed(3) + '%)' : '');
        })(),
        price: money(b.limit), qty: b.qty,
        amount: b.qty * b.limit * (1 + P.FEE)
      });
    }

    // 3) 그리드 청산 — 익절 LOC / 강제 MOC (§5.5, §5.6)
    o.gridExits.forEach(function (x) {
      if (!(x.qty > 0)) return;
      var moc = x.forced;
      sells.push({
        name: '그리드 ' + x.no + '번 ' + (moc ? '강제청산' : '익절'),
        sub: '장 마감 · ' + (moc ? 'MOC 전량' : 'LOC') + ' · 매수가 ' + money(x.px)
          + (moc ? ' · ' + x.elapsed + '거래일' : ' · ' + x.regime + ' +' + pct(x.tp)),
        price: moc ? '종가' : money(x.orderLimit),
        qty: x.qty,
        amount: x.qty * (moc ? o.prevClose : x.orderLimit) * (1 - P.FEE),
        est: moc, force: moc
      });
    });

    // 4) 그리드 신규 진입 (§5.3, §5.4)
    if (o.gridEntry && o.gridEntry.qty > 0) {
      var g = o.gridEntry;
      buys.push({
        name: '그리드 ' + g.rung + '번 진입',
        sub: '장 마감 · LOC · ' + g.regime + ' ' + pct(g.weight),
        price: money(g.limit), qty: g.qty,
        amount: g.qty * g.limit * (1 + P.FEE)
      });
    }

    var row = function (x) {
      return '<div class="ord' + (x.force ? ' force' : '') + (x.need ? ' need' : '') + '">'
        + '<div class="ord-l"><b>' + esc(x.name) + '</b><span>' + esc(x.sub) + '</span></div>'
        + '<div class="ord-r"><b>' + (x.need ? '수량 미입력' : qty(x.qty)) + '</b>'
        + '<span>' + esc(x.price) + (x.need ? '' : ' · ' + money(x.amount))
        + (x.est && !x.need ? ' <em>추정</em>' : '') + '</span></div></div>';
    };
    var group = function (cls, title, note, list) {
      if (!list.length) return '';
      return '<div class="ordgrp ' + cls + '"><h4>' + title + ' <i>' + note + '</i></h4>'
        + list.map(row).join('') + '</div>';
    };

    // 오늘 낼 주문은 아니지만, 체결되면 내일 반드시 해야 하는 것 (§3.5)
    var pending = [];
    if (o.breakout && o.breakout.qty > 0) {
      pending.push({
        name: o.breakout.ticker + ' 돌파 청산',
        sub: '위 매수가 체결된 경우에만 · 다음 거래일 장 시작',
        order: 'MOO 전량 매도', qty: o.breakout.qty
      });
    }

    var num = function (l) { return l.filter(function (x) { return Number.isFinite(x.amount); }); };
    var sum = function (l) { return num(l).reduce(function (s, x) { return s + x.amount; }, 0); };
    var cnt = function (l) { return num(l).reduce(function (s, x) { return s + x.qty; }, 0); };

    $('todayTitle').textContent = o.asOf + ' 종가 기준 · 다음 거래일 주문';
    $('todayTag').textContent = (buys.length + sells.length) + '건';

    if (!buys.length && !sells.length && !pending.length) {
      $('todayOrders').innerHTML = '<div class="ord-none">넣을 주문이 없습니다.'
        + (o.breakoutReason ? '<br>' + esc(o.breakoutReason) : '') + '</div>';
      $('todayTotals').innerHTML = '';
      return;
    }

    $('todayOrders').innerHTML =
      group('sell', '매도', sells.length + '건', sells)
      + group('buy', '매수', buys.length + '건', buys)
      + (pending.length
        ? '<div class="ordgrp pend"><h4>내일 예정 <i>오늘 넣는 주문 아님</i></h4>'
          + pending.map(function (x) {
              return '<div class="ord"><div class="ord-l"><b>' + esc(x.name) + '</b>'
                + '<span>' + esc(x.sub) + '</span></div>'
                + '<div class="ord-r"><b>' + qty(x.qty) + '</b>'
                + '<span>' + esc(x.order) + '</span></div></div>';
            }).join('') + '</div>'
        : '');

    $('todayTotals').innerHTML = '<div class="tot">'
      + '<div><span>매수 합계</span><b class="g">' + (buys.length ? money(sum(buys)) : '—') + '</b>'
        + '<span>' + (buys.length ? cnt(buys).toLocaleString() + '주' : '주문 없음') + '</span></div>'
      + '<div><span>매도 합계</span><b class="a">' + (sells.length ? money(sum(sells)) : '—') + '</b>'
        + '<span>' + (sells.length ? cnt(sells).toLocaleString() + '주' : '주문 없음') + '</span></div>'
      + '<div><span>순현금 변동</span><b>' + money(sum(sells) - sum(buys)) + '</b>'
        + '<span>매도 − 매수</span></div>'
      + '<div><span>주문 후 잔여현금</span><b>' + money(o.boCash + o.gridCash - sum(buys)) + '</b>'
        + '<span>당일 매도대금 제외 (§5.8)</span></div>'
      + '</div>';
  }

  // ── 어제 장 정산 ────────────────────────────────────────
  // 그리드는 진입·청산이 모두 종가로 판정되고(§5.3/§5.5/§5.6) 돌파도 체결 규칙에
  // 재량이 없다(§3.4). 그래서 "어제 무엇이 체결됐나" 는 데이터로 결정된다.
  // 규칙대로의 결과를 제안하고, 사람이 확인해서 반영한다.
  function settleInput() {
    return {
      soxl: data.soxl, soxs: data.soxs, rsi: data.qqq && data.qqq.rsi,
      cash: Number(input.cash) || 0,
      boHold: { ticker: input.boTick || null, qty: Number(input.boQty) || 0 },
      lots: input.lots.map(function (h, i) {
        return { no: i + 1, px: parseFloat(h.px), qty: parseFloat(h.qty),
                 date: h.date, regime: h.regime, held: h.held };
      }).filter(function (h) { return h.held && h.px > 0 && h.qty > 0; }),
      lastRung: Number(input.lastRung) || 0
    };
  }

  function renderSettle() {
    var last = data.soxl[data.soxl.length - 1][0];
    if (input.settledThrough === last) {
      $('settleBox').innerHTML = '<div class="fillbox"><b>' + esc(last)
        + '</b> 장까지 반영 완료. 아래 보유 상태는 오늘 아침 기준입니다.</div>';
      return;
    }
    var r = SPEC.settleDay(settleInput());
    if (!r.ok) {
      $('settleBox').innerHTML = '<div class="fillbox">정산 불가 — ' + esc(r.reason) + '</div>';
      return;
    }
    var moved = r.events.filter(function (e) { return e.sign !== 0; });
    if (!moved.length) {
      $('settleBox').innerHTML = '<div class="fillbox"><b>' + esc(r.date)
        + '</b> 장 — 체결 없음. 상태 변화가 없습니다.'
        + ' <button class="mini" id="settleApply">반영 완료로 표시</button></div>';
      return;
    }
    var cashDelta = r.next.cash - (Number(input.cash) || 0);
    $('settleBox').innerHTML = '<div class="fillbox hit">'
      + '<b>' + esc(r.date) + '</b> 장 정산 제안 — 규칙대로라면 아래가 체결됐습니다.'
      + '<div class="stl">' + moved.map(function (e) {
          return '<div class="stl-row"><span class="' + (e.sign > 0 ? 'up' : 'down') + '">'
            + (e.sign > 0 ? '매도' : '매수') + '</span>'
            + '<b>' + esc(e.label) + '</b>'
            + '<i>' + esc(e.detail) + '</i>'
            + '<u>' + qty(e.qty) + ' @ ' + money(e.price) + '</u></div>';
        }).join('') + '</div>'
      + '현금 ' + money(Number(input.cash) || 0) + ' → <b>' + money(r.next.cash) + '</b>'
      + ' (' + (cashDelta >= 0 ? '+' : '') + money(cashDelta) + ')'
      + ' · 보유 ' + r.next.lots.length + '칸'
      + (r.next.boHold.qty ? ' · 돌파 ' + esc(r.next.boHold.ticker) + ' ' + r.next.boHold.qty + '주' : '')
      + '<br><button class="mini" id="settleApply">이대로 반영</button>'
      + ' <span class="tiny">실제와 다르면 반영 후 아래에서 수정하세요.</span>'
      + '</div>';
  }

  function applySettle() {
    var last = data.soxl[data.soxl.length - 1][0];
    var r = SPEC.settleDay(settleInput());
    if (r.ok) {
      input.cash = Math.round(r.next.cash * 100) / 100;
      input.lastRung = r.next.lastRung;
      input.boTick = r.next.boHold.qty ? r.next.boHold.ticker : '';
      input.boQty = r.next.boHold.qty || 0;
      var fresh = blankLots();
      r.next.lots.forEach(function (l) {
        fresh[l.no - 1] = { held: true, px: String(Math.round(l.px * 100) / 100),
          qty: String(l.qty), date: l.date, regime: l.regime };
      });
      input.lots = fresh;
    }
    input.settledThrough = last;
    syncInputs(); renderHoldings(); render();
  }

  // ── 어제 돌파 체결 판정 ─────────────────────────────────
  function renderFill(f) {
    if (!f || !f.known) {
      $('fillCheck').innerHTML = '<div class="fillbox">어제 체결 판정 불가 — '
        + esc((f && f.reason) || '데이터 부족') + '</div>';
      return;
    }
    if (!f.direction) {
      $('fillCheck').innerHTML = '<div class="fillbox">어제(<b>' + esc(f.date)
        + '</b>)는 돌파 주문이 없었습니다. 청산할 것이 없습니다.</div>';
      return;
    }
    var entered = Number(input.boQty) || 0;
    if (!f.filled) {
      $('fillCheck').innerHTML = '<div class="fillbox">어제(<b>' + esc(f.date) + '</b>) '
        + esc(f.direction) + ' 돌파 <b>미체결</b> — ' + esc(f.reason)
        + (entered > 0 ? ' <em>보유 수량이 ' + entered + '주로 입력돼 있습니다. 확인하세요.</em>' : '')
        + '</div>';
      return;
    }
    $('fillCheck').innerHTML = '<div class="fillbox hit">'
      + '어제(<b>' + esc(f.date) + '</b>) <b>' + esc(f.direction) + ' 돌파 체결</b> · '
      + money(f.price) + ' · ' + esc(f.how)
      + '<br>감시가 ' + money(f.watch) + ' / 지정가 ' + money(f.limit)
      + ' · 당일 시 ' + money(f.bar.o) + ' 고 ' + money(f.bar.h) + ' 저 ' + money(f.bar.l)
      + (entered > 0
        ? '<br>보유 <b>' + entered + '주</b> 입력됨 → 오늘 시가 MOO 전량 매도'
        : '<br><b>아래에 보유 종목과 수량을 입력하세요.</b> 오늘 시가에 MOO 전량 매도해야 합니다.'
          + ' <button class="mini" id="fillApply">' + esc(f.direction) + ' 로 설정</button>')
      + '</div>';
  }

  // ── 7칸 사다리 계획표 ───────────────────────────────────
  function planBase(o) {
    // 시작일이 지정되면 그 날짜 이하의 마지막 봉을 기준봉으로 삼는다
    var d = input.plan.date, bars = data.soxl, ref = bars[bars.length - 1], idx = bars.length - 1;
    if (d) {
      for (var i = bars.length - 1; i >= 0; i--) {
        if (bars[i][0] <= d) { ref = bars[i]; idx = i; break; }
      }
    }
    var exact = ref[0] === d;
    var regime = input.plan.regime === 'AUTO' ? (o.regime || 'TOP') : input.plan.regime;

    // 그리드 현금 — 비워두면 그 시점 종가로 목표배분을 다시 계산한다
    var cash = input.plan.cash;
    var auto = cash === '' || cash == null;
    if (auto) {
      if (idx === bars.length - 1) {
        cash = o.gridCash;                                  // 오늘이면 실주문과 같은 값
      } else {
        var sub = bars.slice(0, idx + 1);
        var ma50 = SPEC.sma(sub, P.MA_FAST), ma200 = SPEC.sma(sub, P.MA_SLOW);
        var w = SPEC.targetWeight(ref[4], ma50, ma200).w;
        cash = (Number(input.cash) || 0) * (1 - w);
      }
    }
    return { ref: ref, idx: idx, exact: exact, regime: regime,
             cash: Number(cash) || 0, auto: auto };
  }

  function renderPlan(o, lots) {
    var b = planBase(o);
    var startRung = lots.length === 0 ? 1 : (Number(input.lastRung) || 0) + 1;
    var plan = SPEC.projectLadder({
      prevClose: b.ref[4], gridCash: b.cash, regime: b.regime,
      lots: lots, startRung: startRung, overrides: input.plan.edits
    });

    var newest = data.soxl[data.soxl.length - 1][0];
    var stale = b.ref[0] !== newest;
    var edited = Object.keys(input.plan.edits).length;
    var editStale = edited > 0 && input.plan.editedAt && input.plan.editedAt !== b.ref[0];

    $('planSummary').innerHTML =
      '<span class="chip' + (stale ? ' warn' : '') + '">기준봉 <b>' + esc(b.ref[0]) + '</b>'
        + (stale ? ' <em>최신 ' + esc(newest) + ' 아님</em>' : '') + '</span>'
      + '<span class="chip">기준 종가 <b>' + money(b.ref[4]) + '</b></span>'
      + '<span class="chip">레짐 <b>' + esc(plan.regime) + '</b> 익절 +' + pct(plan.tp) + '</span>'
      + '<span class="chip">그리드 현금 <b>' + money(b.cash) + '</b>' + (b.auto ? ' <em>자동</em>' : '') + '</span>'
      + (plan.heldCount
        ? '<span class="chip">보유 <b>' + plan.heldCount + '칸</b> · 다음 <b>'
          + (startRung > P.N_GRID ? '없음' : startRung + '번') + '</b></span>'
        : '<span class="chip">사이클 <b>리셋 · 1번부터</b></span>')
      + '<span class="chip">계획 <b>' + plan.plannedCount + '칸</b> 추가 · 합계 <b>'
        + plan.shares.toLocaleString() + '주</b></span>'
      + '<span class="chip">평단 <b>' + money(plan.avgPrice) + '</b></span>'
      + (plan.lastLimit ? '<span class="chip">최저칸 <b>' + money(plan.lastLimit) + '</b> ('
        + (plan.dropPct * 100).toFixed(2) + '%)</span>' : '')
      + '<span class="chip">전량 익절 시 <b class="' + (plan.totalPnl >= 0 ? 'up' : 'down') + '">'
      + (plan.totalPnl >= 0 ? '+' : '') + money(plan.totalPnl) + '</b></span>'
      + (edited ? '<span class="chip warn">수정 <b>' + edited + '칸</b>'
        + (editStale ? ' <em>' + esc(input.plan.editedAt) + ' 기준</em>' : '') + '</span>' : '');

    $('planWarn').innerHTML =
      (stale ? '<div class="warnbar">계획표가 <b>' + esc(b.ref[0]) + '</b> 종가 기준입니다. '
        + '최신 봉은 <b>' + esc(newest) + '</b> 입니다. '
        + '<button class="mini" id="planLatest">최신 종가로</button></div>' : '')
      + (editStale ? '<div class="warnbar">수정한 값이 <b>' + esc(input.plan.editedAt)
        + '</b> 종가 기준입니다. 종가가 바뀌었으므로 계산값과 어긋날 수 있습니다. '
        + '<button class="mini" id="planClear">수정값 지우기</button></div>' : '');

    $('planRows').innerHTML = plan.rows.map(function (r) {
      var e = input.plan.edits[r.no] || {};
      var cls = r.status === 'held' ? 'held' : r.status === 'done' ? 'dim'
        : r.status === 'next' ? 'next' : (r.qty === 0 ? 'dim' : '');
      var mark = r.status === 'held' ? badge('보유', 'sell')
        : r.status === 'done' ? badge('지나감', 'off')
        : r.status === 'next' ? badge('다음', 'ready') : badge('계획', 'off');

      if (r.status === 'done') {
        return '<tr class="dim"><td><b>' + r.no + '번</b></td><td class="num">' + pct(r.weight) + '</td>'
          + '<td colspan="8" class="cond">이번 사이클에서 이미 지나간 칸입니다 (§5.7 · 중간 칸은 다시 채우지 않음)</td>'
          + '<td class="act">' + mark + '</td></tr>';
      }
      var cell = function (k, val, isEdited) {
        if (!r.editable) return '<td class="num locked">' + val + '</td>';
        return '<td><input class="cell" type="number" step="' + (k === 'limit' ? '0.01' : '1')
          + '" data-no="' + r.no + '" data-k="' + k + '" value="' + val + '"'
          + (isEdited ? ' data-edited="1"' : '') + '></td>';
      };
      return '<tr class="' + cls + '" data-no="' + r.no + '">'
        + '<td><b>' + r.no + '번</b></td>'
        + '<td class="num">' + pct(r.weight) + '</td>'
        + cell('limit', r.editable
            ? (Number(e.limit) > 0 ? esc(e.limit) : r.autoLimit.toFixed(2))
            : money(r.limit), r.limitEdited)
        + cell('qty', r.editable
            ? (e.qty != null && e.qty !== '' ? esc(e.qty) : r.autoQty)
            : qty(r.qty), r.qtyEdited)
        + '<td class="num">' + money(r.spend) + (r.cashBound ? ' <em>현금한도</em>' : '') + '</td>'
        + '<td class="num tp">' + money(r.tpPrice) + ' <small>+' + pct(r.tp) + '</small></td>'
        + '<td class="num">' + qty(r.qty) + '</td>'
        + '<td class="num">' + money(r.proceeds) + '</td>'
        + '<td class="num ' + (r.pnl >= 0 ? 'up' : 'down') + '">' + (r.pnl >= 0 ? '+' : '') + money(r.pnl) + '</td>'
        + '<td class="num">' + money(r.cashAfter) + '</td>'
        + '<td class="act">' + mark
        + (r.editable ? '<button class="mini" data-act="hold" data-no="' + r.no + '" title="이 칸을 보유로 등록">등록</button>' : '')
        + (r.editable && (e.limit || e.qty != null) ? '<button class="mini" data-act="undo" data-no="' + r.no + '" title="계산값으로">↺</button>' : '')
        + '</td></tr>';
    }).join('');

    $('planNote').innerHTML =
      '<b>보유 칸</b>은 실제 매수가·수량을 그대로 쓰고, 그 다음 칸부터만 투영합니다. '
      + '따라서 <b>다음</b> 표시된 칸은 위 신규 진입 주문과 항상 같은 값입니다. '
      + '투영 칸은 <b>자기 지정가에 그대로 체결된다</b>고 가정하므로, 실제 체결가(당일 종가)가 더 낮으면 '
      + '매수금액은 이 표보다 적어집니다. 매도 금액은 익절가 × 수량에서 매도수수료 ' + pct(P.FEE) + ' 를 뺀 값입니다. '
      + '수량은 잔여현금이 아니라 <b>그리드 자산 × 칸 비중</b>으로 잡히므로 (§5.4), 한 칸을 적게 사도 다음 칸 예산은 거의 그대로입니다. '
      + '<b>하루에 한 칸만</b> 진입하므로 이 표는 여러 거래일에 걸쳐 실행됩니다.';

    // 경고 배너의 버튼은 innerHTML 로 새로 만들어지므로 위임으로 받는다 (아래 init 참고)

    $('planRows').querySelectorAll('input.cell').forEach(function (el) {
      el.addEventListener('change', function (ev) {
        var no = ev.target.dataset.no, k = ev.target.dataset.k, v = ev.target.value;
        var slot = input.plan.edits[no] || {};
        if (v === '' ) delete slot[k]; else slot[k] = v;
        if (Object.keys(slot).length) input.plan.edits[no] = slot;
        else delete input.plan.edits[no];
        input.plan.editedAt = b.ref[0];
        if (!Object.keys(input.plan.edits).length) delete input.plan.editedAt;
        render();
      });
    });
    $('planRows').querySelectorAll('button.mini').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        var no = +ev.currentTarget.dataset.no, act = ev.currentTarget.dataset.act;
        if (act === 'undo') { delete input.plan.edits[no]; render(); return; }
        var row = plan.rows[no - 1];
        var h = input.lots[no - 1];
        h.held = true; h.px = row.limit.toFixed(2); h.qty = String(row.qty);
        h.date = b.ref[0]; h.regime = row.regime;
        if (no > (Number(input.lastRung) || 0)) { input.lastRung = no; $('lastRung').value = no; }
        renderHoldings(); render();
      });
    });
  }

  function fx(label, value, note) {
    return '<div class="fx"><span>' + esc(label) + '</span><strong>' + value + '</strong><small>' + note + '</small></div>';
  }
  function perm(id, ok) {
    var el = $(id);
    el.textContent = ok ? '가능' : '불가';
    el.className = ok ? 'yes' : 'no';
  }

  // ── 보유 칸 입력 ────────────────────────────────────────
  function renderHoldings() {
    $('holdings').innerHTML = input.lots.map(function (h, i) {
      return '<div class="hold' + (h.held ? ' on' : '') + '">'
        + '<div class="hh"><b>' + (i + 1) + '번 칸</b>'
        + '<label class="chk"><input type="checkbox" data-i="' + i + '" data-k="held"' + (h.held ? ' checked' : '') + '> 보유</label></div>'
        + '<div class="hg">'
        + '<label>매수가<input type="number" step="0.01" data-i="' + i + '" data-k="px" value="' + esc(h.px) + '"></label>'
        + '<label>수량<input type="number" step="1" data-i="' + i + '" data-k="qty" value="' + esc(h.qty) + '"></label>'
        + '<label>매수일<input type="date" data-i="' + i + '" data-k="date" value="' + esc(h.date) + '"></label>'
        + '<label>매수 당시 레짐<select data-i="' + i + '" data-k="regime">'
        + '<option value="TOP"' + (h.regime === 'TOP' ? ' selected' : '') + '>TOP +2.5%</option>'
        + '<option value="BOTTOM"' + (h.regime === 'BOTTOM' ? ' selected' : '') + '>BOTTOM +1.0%</option>'
        + '</select></label>'
        + '</div></div>';
    }).join('');
    $('holdings').querySelectorAll('input,select').forEach(function (el) {
      el.addEventListener('change', function (e) {
        var t = e.target, h = input.lots[+t.dataset.i];
        h[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value;
        if (t.dataset.k === 'held' && t.checked) {
          var no = +t.dataset.i + 1;
          if (no > (Number(input.lastRung) || 0)) { input.lastRung = no; $('lastRung').value = no; }
        }
        renderHoldings(); render();
      });
    });
  }

  // ── CSV ────────────────────────────────────────────────
  function parseCSV(text, name) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return '빈 파일';
    var head = lines[0].split(',').map(function (x) { return x.trim(); });
    var rows = lines.slice(1).filter(Boolean);
    if (head.indexOf('RSI') >= 0) {
      var r = rows[rows.length - 1].split(',');
      data.qqq = { date: r[0].trim(), weekEnd: r[1].trim(), rsi: +r[2], regime: r[3].trim() };
      return 'QQQ 레짐 ' + data.qqq.date + ' · RSI ' + data.qqq.rsi.toFixed(2);
    }
    if (head.indexOf('Open') >= 0 && head.indexOf('Close') >= 0) {
      var bars = rows.map(function (l) {
        var c = l.split(',');
        return [c[0].trim(), +c[1], +c[2], +c[3], +c[4]];
      }).filter(function (b) { return b.slice(1).every(Number.isFinite); });
      var isSoxs = /soxs/i.test(name);
      if (isSoxs) { data.soxs = bars; return 'SOXS ' + bars.length + '봉'; }
      data.soxl = bars; return 'SOXL ' + bars.length + '봉';
    }
    return name + ': 형식을 알 수 없음';
  }

  $('csvFile').addEventListener('change', function (e) {
    var files = Array.from(e.target.files || []);
    if (!files.length) return;
    var msgs = [], left = files.length;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        try { msgs.push(parseCSV(rd.result, f.name)); }
        catch (err) { msgs.push(f.name + ': 읽기 실패'); }
        if (--left === 0) {
          store(LS_DATA, data);
          $('csvLabel').textContent = msgs.join(' · ');
          setState('CSV 반영 · ' + data.soxl[data.soxl.length - 1][0], 'live');
          render();
        }
      };
      rd.readAsText(f);
    });
  });

  // ── 이벤트 ─────────────────────────────────────────────
  $('tickSize').addEventListener('change', function (e) { input.tick = e.target.value; render(); });
  $('maxTicks').addEventListener('input', function (e) { input.maxTicks = e.target.value; render(); });
  ['cash', 'boQty', 'lastRung'].forEach(function (id) {
    $(id).addEventListener('input', function (e) { input[id] = e.target.value; render(); });
  });
  $('boTick').addEventListener('change', function (e) { input.boTick = e.target.value; render(); });
  $('planDate').addEventListener('change', function (e) {
    input.plan.date = e.target.value;
    input.plan.pinned = e.target.value !== data.soxl[data.soxl.length - 1][0];
    render();
  });
  $('planRegime').addEventListener('change', function (e) { input.plan.regime = e.target.value; render(); });
  $('planCash').addEventListener('input', function (e) { input.plan.cash = e.target.value; render(); });
  $('planReset').onclick = function () {
    input.plan.edits = {}; delete input.plan.editedAt; render();
  };
  // 경고 배너 버튼 — 매 렌더마다 새로 그려지므로 컨테이너에 위임한다
  $('settleBox').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'settleApply') applySettle();
  });
  $('fillCheck').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'fillApply') {
      var f = SPEC.lastFill({ soxl: data.soxl, soxs: data.soxs, rsi: data.qqq && data.qqq.rsi });
      if (f && f.filled) { input.boTick = f.direction; syncInputs(); render(); }
    }
  });
  $('planWarn').addEventListener('click', function (e) {
    var id = e.target && e.target.id;
    if (id === 'planLatest') {
      input.plan.date = data.soxl[data.soxl.length - 1][0];
      input.plan.pinned = false;
      $('planDate').value = input.plan.date;
      render();
    } else if (id === 'planClear') {
      input.plan.edits = {}; delete input.plan.editedAt; render();
    }
  });
  $('reloadSeed').onclick = function () {
    data = clone(window.SEED); store(LS_DATA, data);
    setState('시드 데이터 복원');
    $('csvLabel').textContent = 'SOXL / SOXS / qqq_regime CSV 선택';
    render();
  };
  $('resetBtn').onclick = function () {
    input = defaultInput(); store(LS_IN, input);
    syncInputs(); renderHoldings(); render();
  };
  $('printBtn').onclick = function () { window.print(); };

  function syncInputs() {
    $('cash').value = input.cash;
    $('boTick').value = input.boTick || '';
    $('boQty').value = input.boQty;
    $('lastRung').value = input.lastRung;
    $('tickSize').value = input.tick || '0.01';
    $('maxTicks').value = input.maxTicks || 10;
    // 시작일을 직접 고정하지 않았으면 항상 최신 봉을 따라간다
    var bars = data.soxl, newest = bars[bars.length - 1][0];
    if (!input.plan.pinned || !input.plan.date) input.plan.date = newest;
    $('planDate').value = input.plan.date;
    $('planDate').min = bars[0][0];
    $('planRegime').value = input.plan.regime || 'AUTO';
    $('planCash').value = input.plan.cash == null ? '' : input.plan.cash;
  }

  // ── 자동 갱신 ───────────────────────────────────────────
  // GitHub Actions 가 매일 갱신하는 data.json 을 받아온다.
  // JS 가 아니라 JSON 이므로 원격에서 코드가 실행되지 않는다.
  function dataUrl() {
    var m = document.querySelector('meta[name="page-data-url"]');
    var u = m && m.getAttribute('content');
    if (!u || u.indexOf('OWNER/REPO') >= 0) return null;   // 아직 설정 전
    return u;
  }

  function setState(text, cls) {
    $('dataState').textContent = text;
    $('dataState').className = cls || '';
  }

  /** 미국 증시 기준으로 데이터가 며칠 묵었는지 (주말 제외, 휴장일은 미반영) */
  function staleWeekdays(asOf) {
    var d = new Date(asOf + 'T00:00:00Z'), now = new Date();
    var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var n = 0;
    while (d < today) {
      d.setUTCDate(d.getUTCDate() + 1);
      var w = d.getUTCDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  }

  function renderFresh() {
    var asOf = data.soxl[data.soxl.length - 1][0];
    var n = staleWeekdays(asOf);
    // 하루 지난 것은 정상 — 전일 종가로 다음 거래일 주문을 내는 전략이다
    if (n <= 1) { $('freshWarn').innerHTML = ''; return; }
    var bad = n >= 3;
    $('freshWarn').innerHTML = '<div class="freshbar ' + (bad ? 'bad' : 'stale') + '">'
      + '<span>데이터가 <b>' + esc(asOf) + '</b> 종가에 멈춰 있습니다 (평일 기준 ' + n + '일 경과). '
      + (bad ? '이 상태의 주문값은 신뢰할 수 없습니다. ' : '')
      + '새로고침하거나 최신 CSV 를 올리세요.</span>'
      + '<button class="mini" id="freshRetry">다시 받기</button></div>';
  }

  function applyRemote(j) {
    if (!j || !Array.isArray(j.soxl) || !j.soxl.length || !j.qqq) throw new Error('형식 오류');
    var incoming = j.soxl[j.soxl.length - 1][0];
    var current = data.soxl[data.soxl.length - 1][0];
    if (incoming < current) return { skipped: true, incoming: incoming };  // 더 오래된 데이터면 무시
    data = { soxl: j.soxl, soxs: j.soxs || [], qqq: j.qqq };
    store(LS_DATA, data);
    return { skipped: false, incoming: incoming, fresh: incoming !== current };
  }

  function refreshData(manual) {
    var url = dataUrl();
    if (!url) {
      setState('자동 갱신 미설정 · 내장 데이터');
      renderFresh();
      return;
    }
    setState('최신 데이터 확인 중');
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var res = applyRemote(j);
        if (res.skipped) setState('내장 데이터가 더 최신 · ' + res.incoming, 'live');
        else setState('자동 갱신 완료 · ' + res.incoming, 'live');
        syncInputs(); renderHoldings(); render();
      })
      .catch(function (e) {
        setState('자동 갱신 실패 · 저장된 데이터 사용', 'error');
        if (manual) console.warn('data fetch:', e);
        renderFresh();
      });
  }

  $('refreshData').onclick = function () { refreshData(true); };
  $('freshWarn').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'freshRetry') refreshData(true);
  });

  syncInputs();
  renderHoldings();
  render();
  refreshData(false);
})();
