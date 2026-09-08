/* SOXL·SOXS 돌파 + SOXL 레짐 그리드 — 주문 산출 엔진
 *
 * 기준 문서 : SOXL_SOXS_breakout_grid_strategy_final.md (규칙 확정일 2026-09-05)
 * 대응 구현 : engine/strategy.py 의 next_orders()
 *
 * 이 파일에는 DOM 접근이 없다. verify/page_parity.js 가 이 파일을 그대로 불러
 * 파이썬 엔진과 같은 값을 내는지 대조한다. UI 는 app.js 에만 둘 것.
 */
(function (root) {
  'use strict';

  var P = {
    W_BASE: 0.20, W_STRONG: 0.30,        // §2 목표 비중
    MA_FAST: 50, MA_SLOW: 200,           // §2 정배열 판정선
    MA_LEN: 200,                         // §3.1 돌파 필터
    FEE: 0.001,                          // §2 편도 수수료
    BO_K: 0.7, BO_BAND: 0.001,           // §3.2 SOXL 돌파
    BOS_K: 0.5, BOS_BAND: 0.001,         // §4.2 SOXS 돌파
    BOS_RSI: 45, BOS_MAX_W: 0.20,        // §4.1 게이트 / §4.3 투입 상한
    N_GRID: 7,                           // §5.2
    W_TOP: [0.16, 0.20, 0.24, 0.28, 0.32, 0.36, 0.44],
    W_BOTTOM: [0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.22],
    G1_DROP: 0.005, EPS: 0.0075,         // §5.3 진입가격
    TP: { TOP: 0.025, BOTTOM: 0.010 },   // §5.5 익절률
    MAX_DAYS: 7,                         // §5.6 강제청산
    RSI_MID: 50                          // §5.1 레짐 경계
  };

  function sma(rows, n) {
    if (!rows || rows.length < n) return null;
    var s = 0;
    for (var i = rows.length - n; i < rows.length; i++) s += rows[i][4];
    return s / n;
  }

  /** 전일 바로 다음 거래일의 돌파 목표비중을 판정한다 (§2). */
  function targetWeight(close, ma50, ma200) {
    if (ma50 == null || ma200 == null) return { w: P.W_BASE, strong: false };
    var strong = close > ma50 && ma50 > ma200;
    return { w: strong ? P.W_STRONG : P.W_BASE, strong: strong };
  }

  /** 거래일 캘린더: 실제 로드된 SOXL 봉 날짜로 센다 (휴장일 반영). */
  function calendar(soxl) {
    var idx = {};
    for (var i = 0; i < soxl.length; i++) idx[soxl[i][0]] = i;
    return {
      index: function (d) { return idx.hasOwnProperty(d) ? idx[d] : -1; },
      // 기준일로부터 n 거래일 뒤 날짜. 데이터를 벗어나면 주말만 건너뛰어 추정한다.
      after: function (d, n) {
        var i = idx.hasOwnProperty(d) ? idx[d] : -1;
        if (i >= 0 && i + n < soxl.length) return { date: soxl[i + n][0], exact: true };
        var base = i >= 0 ? soxl[soxl.length - 1][0] : d;
        var left = i >= 0 ? n - (soxl.length - 1 - i) : n;
        var t = new Date(base + 'T12:00:00Z');
        while (left > 0) {
          t.setUTCDate(t.getUTCDate() + 1);
          var w = t.getUTCDay();
          if (w !== 0 && w !== 6) left--;
        }
        return { date: t.toISOString().slice(0, 10), exact: false };
      }
    };
  }

  function floorQty(amount, price) {
    if (!(amount > 0) || !(price > 0)) return 0;
    return Math.floor(amount / price);
  }

  /**
   * 다음 거래일 주문 일체를 산출한다.
   *
   * input = {
   *   soxl, soxs : [[date,o,h,l,c], ...]  (마지막 행 = 전일)
   *   rsi        : 확정된 QQQ 주봉 RSI(14, Wilder)
   *   cash       : 총 가용현금 (돌파 슬리브 현금 + 그리드 현금)
   *   boHold     : {ticker:'SOXL'|'SOXS'|null, qty}  전일 돌파 보유분
   *   lots       : [{no, px, qty, date, regime}]     보유 중인 그리드 칸
   *   lastRung   : 이번 사이클에서 마지막으로 매수한 칸 번호 (§5.7)
   * }
   */
  function computeOrders(input) {
    var soxl = input.soxl || [], soxs = input.soxs || [];
    var lots = (input.lots || []).slice().sort(function (a, b) { return a.no - b.no; });
    var last = soxl[soxl.length - 1];
    if (!last) return { error: 'SOXL 일봉이 없습니다.' };

    var cal = calendar(soxl);
    var prevClose = last[4];
    var ma50 = sma(soxl, P.MA_FAST), ma200 = sma(soxl, P.MA_SLOW);
    var maReady = ma50 != null && ma200 != null;

    var rsi = input.rsi;
    var regime = rsi == null ? null : (rsi <= P.RSI_MID ? 'BOTTOM' : 'TOP');
    var tw = targetWeight(prevClose, ma50, ma200);

    // ── §6-1. 전일 돌파 보유분은 시가 MOO 로 청산된다 (예상 대금을 재원에 넣는다)
    var hold = input.boHold || {};
    var holdQty = Number(hold.qty) || 0;
    var holdTick = holdQty > 0 ? hold.ticker : null;
    var sLast = soxs[soxs.length - 1] || null;
    var holdRef = holdTick === 'SOXS' ? (sLast ? sLast[4] : null) : prevClose;
    var holdProceeds = holdTick && holdRef != null
      ? holdQty * holdRef * (1 - P.FEE) : 0;

    // ── §6-2,3. 목표비중 판정 후 현금만 이동 (그리드 보유주식은 팔지 않는다)
    var gridStock = 0;
    for (var i = 0; i < lots.length; i++) gridStock += (Number(lots[i].qty) || 0) * prevClose;
    var pool = (Number(input.cash) || 0) + holdProceeds;
    var total = pool + gridStock;
    var gridCash = Math.max(0, Math.min(pool, total * (1 - tw.w) - gridStock));
    var boCash = pool - gridCash;

    var out = {
      asOf: last[0], prevClose: prevClose, ma50: ma50, ma200: ma200, maReady: maReady,
      rsi: rsi, regime: regime, strong: tw.strong, targetW: tw.w,
      total: total, pool: pool, boCash: boCash, gridCash: gridCash,
      gridStock: gridStock,
      liquidate: holdTick ? {
        ticker: holdTick, qty: holdQty, order: 'MOO 매도',
        estimate: holdProceeds, ref: holdRef
      } : null,
      rebalance: {
        from: Number(input.cash) || 0, toBreakout: boCash, toGrid: gridCash,
        label: tw.strong ? '30 : 70' : '20 : 80'
      }
    };

    // ── §6-4,5. 돌파 — 프리장에서 방향을 하나만 고른다
    var dir = null;
    if (maReady) {
      if (prevClose > ma200) dir = 'SOXL';
      else if (rsi != null && rsi <= P.BOS_RSI) dir = 'SOXS';
    }
    out.direction = dir;
    out.soxlAllowed = maReady && prevClose > ma200;
    out.soxsAllowed = maReady && prevClose <= ma200 && rsi != null && rsi <= P.BOS_RSI;

    if (dir === 'SOXL') {
      var T = prevClose + P.BO_K * (last[2] - last[3]);
      var L = T * (1 + P.BO_BAND);
      out.breakout = {
        ticker: 'SOXL', watch: T, limit: L, budget: boCash, cap: null,
        qty: floorQty(boCash, L * (1 + P.FEE)),
        k: P.BO_K, ref: { date: last[0], h: last[2], l: last[3], c: last[4] }
      };
    } else if (dir === 'SOXS' && sLast) {
      var sT = sLast[4] + P.BOS_K * (sLast[2] - sLast[3]);
      var sL = sT * (1 + P.BOS_BAND);
      var cap = total * P.BOS_MAX_W;              // §4.3 전체자산 20% 상한
      var budget = Math.min(boCash, cap);
      out.breakout = {
        ticker: 'SOXS', watch: sT, limit: sL, budget: budget, cap: cap,
        // 상한이 실제로 물렸을 때만 표시한다 (부동소수점 잡음 무시)
        capped: cap < boCash - 1e-6,
        qty: floorQty(budget, sL * (1 + P.FEE)),
        k: P.BOS_K, ref: { date: sLast[0], h: sLast[2], l: sLast[3], c: sLast[4] }
      };
    } else {
      out.breakout = null;
      out.breakoutReason = !maReady ? 'MA200 계산에 200거래일이 필요합니다.'
        : dir === 'SOXS' ? 'SOXS 일봉이 없습니다.'
        : 'SOXL 이 MA200 이하이고 QQQ 주봉 RSI 가 45 를 초과합니다.';
    }

    // ── §6-6. 그리드 신규 진입 (하루 최대 한 칸)
    var lastRung = Number(input.lastRung) || 0;
    var nextRung = lots.length === 0 ? 1 : lastRung + 1;   // §5.7 사이클 리셋
    if (lots.length === 0) out.cycleReset = true;

    if (regime && nextRung <= P.N_GRID) {
      var W = regime === 'TOP' ? P.W_TOP : P.W_BOTTOM;
      var lvl;
      if (lots.length === 0) {
        lvl = prevClose * (1 - P.G1_DROP);                 // §5.3 1번 칸
      } else {
        var lo = Infinity;
        for (var j = 0; j < lots.length; j++) lo = Math.min(lo, Number(lots[j].px));
        lvl = lo * (1 - P.EPS);                            // §5.3 2~7번 칸
      }
      var gAssets = gridCash + gridStock;                  // §5.4 프리장 기준 그리드 자산
      var targetAmt = gAssets * W[nextRung - 1];
      var availAmt = gridCash / (1 + P.FEE);
      var amt = Math.min(targetAmt, availAmt);
      out.gridEntry = {
        rung: nextRung, weight: W[nextRung - 1], regime: regime, limit: lvl,
        gridAssets: gAssets, target: targetAmt, avail: availAmt, amount: amt,
        qty: floorQty(amt, lvl),                           // §5.4 수량은 지정가 기준
        cashBound: availAmt < targetAmt
      };
    } else {
      out.gridEntry = null;
      out.gridEntryReason = !regime ? 'QQQ 주봉 RSI 가 없습니다.'
        : '7칸을 모두 사용했습니다. 전량 청산 후 1번 칸부터 다시 시작합니다.';
    }

    // ── §6-6. 보유 칸의 익절 LOC / 강제청산 MOC
    var lastIdx = soxl.length - 1;
    out.gridExits = lots.map(function (x) {
      var bi = cal.index(x.date);
      var heldNow = bi >= 0 ? lastIdx - bi : null;          // 전일까지 경과 거래일
      var elapsed = heldNow == null ? null : heldNow + 1;   // 다음 거래일 기준
      var forced = elapsed != null && elapsed >= P.MAX_DAYS;
      var rg = x.regime === 'BOTTOM' ? 'BOTTOM' : 'TOP';
      var due = cal.after(x.date, P.MAX_DAYS);
      var tpLimit = Number(x.px) * (1 + P.TP[rg]);
      return {
        no: x.no, px: Number(x.px), qty: Number(x.qty), date: x.date, regime: rg,
        tp: P.TP[rg],
        // limit : 익절 기준가 (강제청산일에도 §5.6 의 "익절로 기록" 판정에 쓴다)
        // orderLimit : 실제 주문 지정가. MOC 는 지정가가 없으므로 null.
        limit: tpLimit,
        orderLimit: forced ? null : tpLimit,
        elapsed: elapsed, forced: forced,
        order: forced ? 'MOC 매도 (강제청산)' : 'LOC 매도 (익절)',
        dueDate: due.date, dueExact: due.exact,
        unknownDate: bi < 0
      };
    });

    return out;
  }

  /**
   * 어제 낸 돌파 감시주문이 체결됐는지 판정한다 (§3.4).
   *
   * 마지막 봉(= 어제 장)의 OHLC 만 있으면 결정된다. 주문 자체는 그 전날 종가로
   * 확정됐고, 체결 규칙에 재량이 없기 때문이다. 따라서 사용자가 "체결됐나"를
   * 판단할 필요가 없다 — 데이터가 이미 답을 갖고 있다.
   *
   * 수량은 알 수 없다. 어제 아침의 돌파 슬리브 현금에 달려 있고 그 값은
   * 지금 남아 있지 않다. 그래서 종목·체결가까지만 돌려주고 수량은 사용자가 넣는다.
   */
  function lastFill(input) {
    var soxl = input.soxl || [], soxs = input.soxs || [];
    var n = soxl.length;
    if (n < P.MA_LEN + 2) return { known: false, reason: '봉이 부족합니다.' };

    var cur = soxl[n - 1], prev = soxl[n - 2];          // cur = 어제 장, prev = 그 전날
    var ma = sma(soxl.slice(0, n - 1), P.MA_LEN);       // prev 까지의 MA200
    if (ma == null) return { known: false, reason: 'MA200 을 계산할 수 없습니다.' };

    var rsi = input.rsi;
    var dir = null;
    if (prev[4] > ma) dir = 'SOXL';
    else if (rsi != null && rsi <= P.BOS_RSI) dir = 'SOXS';
    if (!dir) {
      return { known: true, date: cur[0], direction: null, filled: false,
               reason: '어제는 돌파 주문 자체가 없었습니다.' };
    }

    var k = dir === 'SOXL' ? P.BO_K : P.BOS_K;
    var band = dir === 'SOXL' ? P.BO_BAND : P.BOS_BAND;
    var pb, cb;
    if (dir === 'SOXL') { pb = prev; cb = cur; }
    else {
      var m = soxs.length - soxl.length;                // SOXS 를 같은 날짜에 맞춘다
      pb = soxs[n - 2 + m]; cb = soxs[n - 1 + m];
      if (!pb || !cb || pb[0] !== prev[0] || cb[0] !== cur[0]) {
        return { known: false, reason: 'SOXS 봉을 맞출 수 없습니다.' };
      }
    }

    var T = pb[4] + k * (pb[2] - pb[3]);
    var L = T * (1 + band);
    var out = { known: true, date: cur[0], direction: dir, watch: T, limit: L,
                bar: { o: cb[1], h: cb[2], l: cb[3], c: cb[4] } };

    if (cb[2] <= T) {
      out.filled = false; out.reason = '고가 ' + cb[2].toFixed(2) + ' 가 감시가에 못 미쳤습니다.';
      return out;
    }
    if (cb[1] >= T) {                                   // 갭으로 감시가 위에서 출발
      if (cb[1] <= L) { out.filled = true; out.price = cb[1]; out.how = '갭 시가 체결'; return out; }
      if (cb[3] <= L) { out.filled = true; out.price = L;     out.how = '갭 후 되돌아와 지정가 체결'; return out; }
      out.filled = false;
      out.reason = '갭 시가 ' + cb[1].toFixed(2) + ' 가 지정가를 넘고 되돌아오지 않았습니다.';
      return out;
    }
    out.filled = true; out.price = L; out.how = '장중 돌파 · 지정가 체결';
    return out;
  }

  /**
   * 7칸 사다리 계획표 (§5.3~5.5).
   *
   * "각 칸이 자기 지정가에 그대로 체결된다"는 가정 아래 1~7번 칸의
   * 매수 지정가·수량·금액과 익절 목표를 미리 뽑는다. 실제 체결가는 당일 종가이므로
   * 지정가 이하일 수 있고, 그러면 실제 수량·금액은 이 표보다 유리해진다.
   *
   * 현재 사이클 상태를 반영한다. 이미 보유한 칸은 실제 매수가·수량을 그대로 쓰고,
   * 그 다음 칸부터만 투영한다. 따라서 startRung 행은 computeOrders() 의
   * 실제 주문과 완전히 같아야 한다 (verify/page_ladder.js 가 이걸 검사한다).
   *
   * input = {
   *   prevClose : 기준봉 종가
   *   gridCash  : 그리드 슬리브 가용현금
   *   regime    : 'TOP' | 'BOTTOM'
   *   lots      : [{no, px, qty, regime}]  이미 보유한 칸
   *   startRung : 다음에 매수할 칸 번호 (보유가 없으면 1)
   *   overrides : { 칸번호: {limit, qty} }  사용자가 직접 고친 값
   * }
   */
  function projectLadder(input) {
    var regime = input.regime === 'BOTTOM' ? 'BOTTOM' : 'TOP';
    var W = regime === 'TOP' ? P.W_TOP : P.W_BOTTOM;
    var ov = input.overrides || {};
    var cash = Number(input.gridCash) || 0;
    var prevClose = Number(input.prevClose) || 0;

    var held = {}, heldQty = 0, minFill = Infinity;
    (input.lots || []).forEach(function (l) {
      var q = Number(l.qty) || 0, px = Number(l.px) || 0;
      if (!(q > 0) || !(px > 0)) return;
      held[l.no] = { px: px, qty: q, regime: l.regime === 'BOTTOM' ? 'BOTTOM' : 'TOP' };
      heldQty += q;
      minFill = Math.min(minFill, px);
    });
    var hasHeld = heldQty > 0;
    var start = Number(input.startRung) || (hasHeld ? P.N_GRID + 1 : 1);

    var rows = [], projected = [], projQty = 0;
    var vp = prevClose;                    // 평가 기준가 — 투영이 진행되면 마지막 가정 체결가
    var spendSum = 0, proceedSum = 0, pnlSum = 0;

    for (var n = 1; n <= P.N_GRID; n++) {
      var h = held[n];
      if (h) {                              // ── 이미 보유한 칸: 실제 값 그대로
        var htp = P.TP[h.regime], htpPx = h.px * (1 + htp);
        var hSpend = h.qty * h.px * (1 + P.FEE), hProc = h.qty * htpPx * (1 - P.FEE);
        rows.push({
          no: n, status: 'held', weight: W[n - 1], regime: h.regime, tp: htp,
          limit: h.px, autoLimit: h.px, limitEdited: false,
          qty: h.qty, autoQty: h.qty, qtyEdited: false,
          spend: hSpend, tpPrice: htpPx, proceeds: hProc, pnl: hProc - hSpend,
          cashBefore: cash, cashAfter: cash, cashBound: false, editable: false
        });
        spendSum += hSpend; proceedSum += hProc; pnlSum += hProc - hSpend;
        continue;
      }
      if (n < start) {                      // ── 이번 사이클에서 이미 지나간 칸 (§5.7)
        rows.push({
          no: n, status: 'done', weight: W[n - 1], regime: regime, tp: P.TP[regime],
          limit: null, qty: 0, spend: 0, tpPrice: null, proceeds: 0, pnl: 0,
          cashBefore: cash, cashAfter: cash, cashBound: false, editable: false
        });
        continue;
      }

      // ── 투영할 칸
      var e = ov[n] || {};
      var tp = P.TP[regime];
      // 지정가 — 보유·투영이 하나도 없으면 전일 종가 −0.5%, 아니면 최저 매수가 −0.75% (§5.3)
      var autoLimit = (minFill === Infinity)
        ? prevClose * (1 - P.G1_DROP)
        : minFill * (1 - P.EPS);
      var limit = Number(e.limit) > 0 ? Number(e.limit) : autoLimit;

      // 수량 — 프리장 그리드 자산과 지정가로만 (§5.4)
      var gridAssets = cash + (heldQty + projQty) * vp;
      var target = gridAssets * W[n - 1];
      var avail = cash / (1 + P.FEE);
      var amount = Math.min(target, avail);
      var autoQty = amount > 0 && limit > 0 ? Math.floor(amount / limit) : 0;
      var qty = e.qty != null && e.qty !== '' ? Math.max(0, Math.floor(Number(e.qty))) : autoQty;

      var spend = qty * limit * (1 + P.FEE);
      var tpPrice = limit * (1 + tp);
      var proceeds = qty * tpPrice * (1 - P.FEE);
      var cashAfter = cash - spend;

      rows.push({
        no: n, status: n === start ? 'next' : 'plan',
        weight: W[n - 1], regime: regime, tp: tp,
        limit: limit, autoLimit: autoLimit, limitEdited: Number(e.limit) > 0,
        qty: qty, autoQty: autoQty,
        qtyEdited: e.qty != null && e.qty !== '' && Number(e.qty) !== autoQty,
        target: target, avail: avail, amount: amount,
        spend: spend, tpPrice: tpPrice, proceeds: proceeds, pnl: proceeds - spend,
        cashBefore: cash, cashAfter: cashAfter,
        cashBound: avail < target, editable: true,
        short: qty === 0
      });

      if (qty > 0) {
        projected.push({ no: n, px: limit, qty: qty });
        projQty += qty;
        minFill = Math.min(minFill, limit);
        vp = limit;
        spendSum += spend; proceedSum += proceeds; pnlSum += proceeds - spend;
      }
      cash = cashAfter;
    }

    var all = Object.keys(held).map(function (k) { return held[k]; }).concat(projected);
    var shares = heldQty + projQty;
    return {
      regime: regime, tp: P.TP[regime], rows: rows,
      startRung: start, heldCount: Object.keys(held).length,
      plannedCount: projected.length,
      filled: Object.keys(held).length + projected.length,
      shares: shares,
      totalSpend: spendSum, totalProceeds: proceedSum, totalPnl: pnlSum,
      cashLeft: cash,
      avgPrice: shares ? all.reduce(function (s, f) { return s + f.px * f.qty; }, 0) / shares : null,
      lastLimit: projected.length ? projected[projected.length - 1].px
        : (minFill === Infinity ? null : minFill),
      dropPct: shares && prevClose ? (projected.length
        ? projected[projected.length - 1].px : minFill) / prevClose - 1 : null
    };
  }

  root.SPEC = {
    P: P, sma: sma, targetWeight: targetWeight, calendar: calendar,
    computeOrders: computeOrders, projectLadder: projectLadder, lastFill: lastFill
  };
})(typeof window !== 'undefined' ? window : globalThis);
