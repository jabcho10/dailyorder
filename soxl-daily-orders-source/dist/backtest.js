/* 백테스트 엔진 — engine/strategy.py 의 run() 을 그대로 옮긴 것.
 *
 * 대응 구현 : engine/strategy.py 의 Breakout / Grid / run / stats / annual
 * 검증      : verify/page_backtest.js 가 이 파일과 파이썬 엔진의 결과를 대조한다.
 *
 * 이 파일에는 DOM 접근이 없다. 파라미터는 전부 spec.js 의 SPEC.P 에서 읽는다 —
 * 규칙 값을 여기에 다시 적지 않는다. 여기 있는 것은 "하루의 순서"뿐이다.
 *
 * 주 : 백테스트는 소수 주식수를 쓴다 (문서 §2 "투자금 수익률 방식").
 *      SOXS 조정가는 반복된 역분할이 반영돼 과거 구간에서 1주 단가가 수십억
 *      달러라 정수 내림을 적용할 수 없다. 실주문 수량 내림은 spec.js 에서만 한다.
 */
(function (root) {
  'use strict';

  var SPEC = root.SPEC;
  if (!SPEC) throw new Error('backtest.js 는 spec.js 다음에 로드해야 합니다.');
  var P = SPEC.P;

  var MIN_TRADE = 1.0;      // 이 금액 미만 주문은 미체결 (먼지 포지션 방지)
  var INIT = 100000.0;

  // ── 데이터 준비 ─────────────────────────────────────────
  function sma(bars, n) {
    var out = [], acc = 0;
    for (var i = 0; i < bars.length; i++) {
      acc += bars[i].c;
      if (i >= n) acc -= bars[i - n].c;
      out.push(i >= n - 1 ? acc / n : null);
    }
    return out;
  }

  /**
   * CSV 에서 읽은 배열을 백테스트용 바로 묶는다.
   *
   * input = {
   *   soxl, soxs : [[date,o,h,l,c], ...]
   *   rsi        : {날짜: QQQ 주봉 RSI}   — 각 행은 이미 '전주 금요일 확정치'
   *   maFast, maSlow : 정배열 판정선 (생략하면 SPEC.P 값)
   * }
   * SOXL 일봉이 기준 캘린더다. SOXS 는 같은 날짜만 매단다.
   */
  function prepare(input) {
    var maFast = input.maFast || P.MA_FAST, maSlow = input.maSlow || P.MA_SLOW;
    var rsi = input.rsi || {};
    var xs = {};
    (input.soxs || []).forEach(function (r) {
      xs[r[0]] = { o: r[1], h: r[2], l: r[3], c: r[4] };
    });
    var bars = (input.soxl || []).map(function (r) {
      var v = rsi[r[0]];
      return {
        d: r[0], o: r[1], h: r[2], l: r[3], c: r[4],
        rsi: v == null ? null : v,
        rg: v == null ? 'TOP' : (v <= P.RSI_MID ? 'BOTTOM' : 'TOP'),
        x: xs[r[0]] || null
      };
    });
    var MA = sma(bars, P.MA_LEN), MF = sma(bars, maFast), MS = sma(bars, maSlow);
    bars.forEach(function (b, i) { b.ma = MA[i]; b.maF = MF[i]; b.maS = MS[i]; });
    return bars;
  }

  /** 전일 바로 다음 거래일의 돌파 목표비중 (§2). */
  function targetW(p, dynamic) {
    if (!dynamic || p.maF == null || p.maS == null) return P.W_BASE;
    return (p.c > p.maF && p.maF > p.maS) ? P.W_STRONG : P.W_BASE;
  }

  // ── 슬리브 ──────────────────────────────────────────────
  /** 전량 롱/현금. 최대 1일 보유. */
  function Breakout(cash) {
    this.cash = cash; this.sh = 0; this.px = 0; this.tick = null;
    this.trades = { SOXL: [], SOXS: [] };
    this.log = [];
  }
  Breakout.prototype.mv = function (pl, ps) {
    return this.sh === 0 ? 0 : this.sh * (this.tick === 'SOXL' ? pl : ps);
  };
  Breakout.prototype.eq = function (pl, ps) { return this.cash + this.mv(pl, ps); };

  /** 1) 전일 매수분 LOO 청산 — 산 종목의 시가로. 리밸런싱보다 먼저. */
  Breakout.prototype.exitOpen = function (B, i) {
    if (this.sh === 0) return;
    var bar = this.tick === 'SOXL' ? B[i] : B[i].x;
    this.cash += this.sh * bar.o * (1 - P.FEE);
    var ret = bar.o / this.px - 1;
    this.trades[this.tick].push(ret);
    this.log.push({ date: B[i].d, ticker: this.tick, entry: this.px, exit: bar.o, ret: ret });
    this.sh = 0; this.tick = null;
  };

  /** 자동감시주문(스톱-리밋). 감시가·지정가·수량 모두 전일 데이터로 확정된다. */
  Breakout.prototype.order = function (bar, prev, k, band, tick, cap) {
    var T = prev.c + k * (prev.h - prev.l);
    var LMT = T * (1 + band);
    var budget = cap == null ? this.cash : Math.min(this.cash, cap);
    if (budget < MIN_TRADE) return;
    var q = budget / (LMT * (1 + P.FEE));   // 프리장에 확정되는 주문수량
    if (bar.h <= T) return;
    var fill = null;
    if (bar.o >= T) {                       // 시가가 이미 감시가 위 = 갭
      if (bar.o <= LMT) fill = bar.o;       // 갭이 밴드 안 → 체결
      else if (bar.l <= LMT) fill = LMT;    // 되돌아오면 체결
      // 갭이 지정가 초과 → 미체결 (추격 차단)
    } else {
      fill = LMT;                           // 장중 정상 돌파 (밴드 상단 가정, 보수적)
    }
    if (fill == null) return;
    this.sh = q; this.px = fill; this.tick = tick;
    this.cash -= q * fill * (1 + P.FEE);
  };

  /** 프리장에서 방향을 하나만 고른다. 두 조건은 배타적이다. */
  Breakout.prototype.enter = function (B, i, total, bosOn) {
    var b = B[i], p = B[i - 1];
    if (p.ma == null) return;               // MA200 이 아직 없으면 어느 쪽도 주문하지 않는다
    if (p.c > p.ma) { this.order(b, p, P.BO_K, P.BO_BAND, 'SOXL', null); return; }
    if (bosOn && b.rsi != null && b.rsi <= P.BOS_RSI && b.x && p.x) {
      this.order(b.x, p.x, P.BOS_K, P.BOS_BAND, 'SOXS',
        total == null ? null : total * P.BOS_MAX_W);
    }
  };

  /** 7칸 사다리. 진입·청산 모두 종가(LOC/MOC). */
  function Grid(cash) {
    this.cash = cash; this.pos = []; this.ptr = 0; this.trades = []; this.log = [];
  }
  Grid.prototype.sh = function () {
    return this.pos.reduce(function (s, p) { return s + p.q; }, 0);
  };
  Grid.prototype.eq = function (px) { return this.cash + this.sh() * px; };

  Grid.prototype.step = function (B, i) {
    var b = B[i], p = B[i - 1], c = b.c, rg = b.rg;
    var W = rg === 'TOP' ? P.W_TOP : P.W_BOTTOM;
    var self = this;

    // 1) 진입 — LOC 매수 1건. 지정가·수량 모두 프리장에 확정됨
    if (this.ptr < P.N_GRID) {
      var lvl = this.pos.length === 0
        ? p.c * (1 - P.G1_DROP)
        : Math.min.apply(null, this.pos.map(function (x) { return x.px; })) * (1 - P.EPS);
      var gassets = this.cash + this.sh() * p.c;          // 프리장 기준 그리드 자산 (전일 종가)
      var budget = Math.min(gassets * W[this.ptr], this.cash / (1 + P.FEE));
      if (budget >= MIN_TRADE) {
        var q = budget / lvl;                             // 수량은 LOC 지정가 기준
        if (c <= lvl) {                                   // 종가가 지정가 이하 → 체결
          this.cash -= q * c * (1 + P.FEE);               // 실제 체결가는 당일 종가
          this.pos.push({ q: q, px: c, day: i, tp: P.TP[rg], rg: rg, no: this.ptr + 1 });
          this.ptr += 1;
        }
      }
    }

    // 2) 청산 — 칸별 LOC 익절 / MOC 시간손절
    var keep = [];
    this.pos.forEach(function (x) {
      var tpHit = c / x.px - 1 >= x.tp;
      var forced = i - x.day >= P.MAX_DAYS;
      if (tpHit || forced) {
        self.cash += x.q * c * (1 - P.FEE);
        self.trades.push(c / x.px - 1);
        self.log.push({
          date: b.d, no: x.no, entry: x.px, exit: c, ret: c / x.px - 1,
          days: i - x.day, kind: tpHit ? 'tp' : 'moc', rg: x.rg
        });
      } else keep.push(x);
    });
    this.pos = keep;
    if (!this.pos.length) this.ptr = 0;                   // 전량 청산되면 사다리 리셋
  };

  // ── 포트폴리오 ──────────────────────────────────────────
  /**
   * 일일 순서 (문서 §6): LOO 청산 → 목표비중 판정 → 현금 이동 → 돌파 주문 → 그리드.
   *
   * opts = {
   *   i0, i1  : 매매 구간 (봉 인덱스, 양끝 포함). 지표는 전체 이력으로 계산된다.
   *   wBo     : 돌파 슬리브 비중 고정값. null 이면 정배열 판정으로 매일 전환.
   *   bosOn   : SOXS 돌파 사용 여부
   *   init    : 초기 자본
   * }
   */
  function run(B, opts) {
    opts = opts || {};
    var i0 = opts.i0 == null ? 1 : Math.max(1, opts.i0);
    var i1 = opts.i1 == null ? B.length - 1 : Math.min(B.length - 1, opts.i1);
    var wBo = opts.wBo == null ? null : opts.wBo;
    var bosOn = opts.bosOn !== false;
    var init = opts.init == null ? INIT : opts.init;

    var w0 = wBo == null ? P.W_BASE : wBo;
    var bo = new Breakout(init * w0), g = new Grid(init * (1 - w0));
    var eq = [], maxGross = 0;

    for (var i = i0; i <= i1; i++) {
      var wt = wBo == null ? targetW(B[i - 1], true) : wBo;
      bo.exitOpen(B, i);                                  // 1) 돌파 포지션은 매일 아침 현금이 된다
      var pos = g.sh() * B[i].o;                          // 2) 그리드 보유주식은 팔지 않는다
      var pool = bo.cash + g.cash;
      var tot = pool + pos;
      var want = Math.max(0, Math.min(pool, tot * (1 - wt) - pos));
      g.cash = want; bo.cash = pool - want;               // 3) 현금만 이동해 목표비중 복원
      if (wt > 0) bo.enter(B, i, tot, bosOn);             // 4) 방향 하나만 골라 감시주문
      g.step(B, i);                                       // 5) 그리드 LOC/MOC
      var cl = B[i].c, cs = B[i].x ? B[i].x.c : cl;
      var v = bo.eq(cl, cs) + g.eq(cl);
      eq.push([B[i].d, v]);
      var gross = v > 0 ? (bo.mv(cl, cs) + g.sh() * cl) / v : 0;
      if (gross > maxGross) maxGross = gross;
    }
    return { eq: eq, bo: bo, grid: g, maxGross: maxGross, init: init, i0: i0, i1: i1 };
  }

  /** 매수 후 보유 — 구간 첫날 시가로 사서 들고 간다. */
  function buyHold(B, i0, i1, init) {
    var sh = init / B[i0].o, out = [];
    for (var i = i0; i <= i1; i++) out.push([B[i].d, sh * B[i].c]);
    return out;
  }

  // ── 성과 지표 ───────────────────────────────────────────
  function dayGap(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function stats(eq, init) {
    if (!eq.length) return null;
    var v0 = init == null ? INIT : init;
    var peak = eq[0][1], mdd = 0, uw = 0, mx = 0;
    var peakDate = eq[0][0], mddFrom = eq[0][0], mddAt = eq[0][0];
    for (var i = 0; i < eq.length; i++) {
      var v = eq[i][1];
      if (v >= peak) { peak = v; peakDate = eq[i][0]; uw = 0; }
      else {
        uw += 1; if (uw > mx) mx = uw;
        var dd = v / peak - 1;
        if (dd < mdd) { mdd = dd; mddFrom = peakDate; mddAt = eq[i][0]; }
      }
    }
    var yrs = dayGap(eq[0][0], eq[eq.length - 1][0]) / 365.25;
    var final = eq[eq.length - 1][1];
    var cagr = yrs > 0 ? Math.pow(final / v0, 1 / yrs) - 1 : final / v0 - 1;
    return {
      cagr: cagr, mdd: mdd, calmar: mdd ? cagr / Math.abs(mdd) : null,
      maxuw: mx, final: final, yrs: yrs, total: final / v0 - 1,
      from: eq[0][0], to: eq[eq.length - 1][0], n: eq.length,
      mddFrom: mddFrom, mddAt: mddAt
    };
  }

  /** 연도별 수익률 — 직전 연말 자산 대비. 첫 해는 초기자본 대비. */
  function annual(eq, init) {
    var last = {}, order = [];
    eq.forEach(function (r) {
      var y = r[0].slice(0, 4);
      if (!(y in last)) order.push(y);
      last[y] = r[1];
    });
    var prev = init == null ? INIT : init, out = [];
    order.forEach(function (y) { out.push({ year: y, ret: last[y] / prev - 1 }); prev = last[y]; });
    return out;
  }

  /** 연도 내 최대낙폭 (문서 §8 과 같은 정의: 해당 연도 안에서만 고점 갱신). */
  function annualMdd(eq) {
    var peak = {}, cur = {}, order = [];
    eq.forEach(function (r) {
      var y = r[0].slice(0, 4), v = r[1];
      if (!(y in peak)) { peak[y] = v; cur[y] = 0; order.push(y); }
      peak[y] = Math.max(peak[y], v);
      cur[y] = Math.min(cur[y], v / peak[y] - 1);
    });
    return order.map(function (y) { return { year: y, mdd: cur[y] }; });
  }

  /** 낙폭 곡선 — 자산곡선의 고점 대비 하락률. */
  function drawdown(eq) {
    var peak = -Infinity;
    return eq.map(function (r) {
      if (r[1] > peak) peak = r[1];
      return [r[0], r[1] / peak - 1];
    });
  }

  function tradeStats(rets) {
    if (!rets || !rets.length) return { n: 0 };
    var wins = rets.filter(function (r) { return r > 0; }).length;
    var sum = rets.reduce(function (s, r) { return s + r; }, 0);
    return {
      n: rets.length, win: wins / rets.length, avg: sum / rets.length,
      best: Math.max.apply(null, rets), worst: Math.min.apply(null, rets)
    };
  }

  // ── CSV 파싱 ────────────────────────────────────────────
  // data/*.csv 를 그대로 읽는다. verify/page_backtest.js 도 같은 함수를 써서
  // 파이썬 엔진이 읽은 것과 같은 숫자가 들어갔는지까지 함께 검사한다.
  function rows(text) {
    var lines = String(text || '').trim().split(/\r?\n/);
    if (lines.length < 2) return { head: [], body: [] };
    return {
      head: lines[0].split(',').map(function (x) { return x.trim(); }),
      body: lines.slice(1).filter(Boolean)
    };
  }

  /** OHLC CSV → [[date,o,h,l,c], ...] */
  function parseBars(text) {
    var r = rows(text);
    if (r.head.indexOf('Open') < 0 || r.head.indexOf('Close') < 0) {
      throw new Error('OHLC CSV 가 아닙니다 (Open/Close 열 없음)');
    }
    return r.body.map(function (l) {
      var c = l.split(',');
      return [c[0].trim(), +c[1], +c[2], +c[3], +c[4]];
    }).filter(function (b) {
      return b[0] && b.slice(1).every(function (v) { return isFinite(v); });
    });
  }

  /** qqq_regime.csv → {날짜: RSI} */
  function parseRsi(text) {
    var r = rows(text);
    var iR = r.head.indexOf('RSI');
    if (iR < 0) throw new Error('레짐 CSV 가 아닙니다 (RSI 열 없음)');
    var out = {};
    r.body.forEach(function (l) {
      var c = l.split(',');
      var v = parseFloat(c[iR]);
      if (isFinite(v)) out[c[0].trim()] = v;
    });
    return out;
  }

  /** 날짜(YYYY-MM-DD) 이상인 첫 봉 인덱스. 없으면 -1. */
  function indexFrom(B, date) {
    for (var i = 0; i < B.length; i++) if (B[i].d >= date) return i;
    return -1;
  }
  /** 날짜 이하인 마지막 봉 인덱스. 없으면 -1. */
  function indexTo(B, date) {
    for (var i = B.length - 1; i >= 0; i--) if (B[i].d <= date) return i;
    return -1;
  }

  root.BT = {
    MIN_TRADE: MIN_TRADE, INIT: INIT,
    prepare: prepare, targetW: targetW, run: run, buyHold: buyHold,
    stats: stats, annual: annual, annualMdd: annualMdd, drawdown: drawdown,
    tradeStats: tradeStats, indexFrom: indexFrom, indexTo: indexTo, sma: sma,
    parseBars: parseBars, parseRsi: parseRsi
  };
})(typeof window !== 'undefined' ? window : globalThis);
