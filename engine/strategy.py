# -*- coding: utf-8 -*-
"""
SOXL/SOXS 확정 전략 엔진 — 단일 파일, 외부 의존 없음 (표준 라이브러리만)

기준 문서 : SOXL_SOXS_breakout_grid_strategy_final.md (규칙 확정일 2026-09-05)

배분   : 전일 SOXL 종가 > MA50 > MA200 → 돌파 30% / 그리드 70%
         그 외                        → 돌파 20% / 그리드 80%
돌파   : 자동감시주문(스톱-리밋). 감시가·지정가·수량 모두 전일 데이터로 확정된다.
         프리장에서 방향을 하나만 고른다 — 두 종목을 동시에 제출하지 않는다.
         · SOXL 전일종가 > MA200                     → SOXL 로 돌파 (k=0.7)
         · SOXL 전일종가 ≤ MA200 & QQQ주봉RSI ≤ 45   → SOXS 로 돌파 (k=0.5)
         SOXS 투입액은 전체 자산의 20%를 넘지 않는다.
그리드 : 7칸 사다리(SOXL 전용). QQQ 주봉 RSI 레짐에 따라 사이즈와 익절률이 달라짐.
         주문수량은 프리장 가용현금과 LOC 지정가로만 계산한다 —
         같은 날 청산될 매도대금은 재원으로 쓰지 않는다.
체결   : 그리드는 LOC/MOC(종가), 돌파 청산은 LOO(시가).

주 : 백테스트는 소수 주식수를 쓴다. SOXS 조정가는 반복된 역분할이 반영돼
     과거 구간에서 1주 단가가 수십억 달러라 정수 내림을 적용할 수 없다
     (문서 §2 "투자금 수익률 방식"). 실주문 수량 내림은 next_orders() 에서만 한다.
"""
import csv, os
from datetime import date

# ──────────────────────────────────────────────────────────────
# 확정 파라미터
# ──────────────────────────────────────────────────────────────
W_BASE     = 0.20                                   # 기본 돌파 슬리브 목표비중
W_STRONG   = 0.30                                   # 정배열(강한 상승장) 목표비중
MA_FAST    = 50                                     # 정배열 단기선
MA_SLOW    = 200                                    # 정배열 장기선 (돌파 필터 MA_LEN 과 별개)
DYNAMIC_W  = True                                   # False 면 항상 W_BASE 고정
FEE        = 0.001                                  # 매수/매도 각각
MIN_TRADE  = 1.0                                    # 이 금액 미만 주문은 미체결 (먼지 포지션 방지)

# 돌파 — 전부 전일 데이터로 계산 가능
BO_K       = 0.7                                    # 감시가 = 전일종가 + K × 전일레인지
BO_BAND    = 0.001                                  # 지정가 = 감시가 × (1+BAND). 갭 추격 차단
MA_LEN     = 200                                    # 전일종가 > MA200 일 때만 주문

# 돌파 (SOXS) — SOXL 이 MA200 아래라 쉬는 날에만
BOS_ON     = True                                   # False 면 기존 SOXL 전용 동작과 완전히 동일
BOS_K      = 0.5                                    # 문서 §4.2
BOS_BAND   = 0.001                                  # 갭 추격 차단, SOXL 과 동일
BOS_RSI    = 45.0                                   # QQQ 주봉 RSI 이하일 때만 (문서 §4.1)
BOS_MAX_W  = 0.20                                   # 전체 자산 대비 SOXS 투입 상한 (문서 §4.3)

# 그리드
N_GRID     = 7
W_TOP      = [0.16, 0.20, 0.24, 0.28, 0.32, 0.36, 0.44]   # 칸별 비중 (그리드 슬리브 총자산 대비)
W_BOTTOM   = [w / 2 for w in W_TOP]                       # BOTTOM 레짐은 정확히 절반
G1_DROP    = 0.005                                  # 1번칸: 전일종가 × (1 − 0.5%)
EPS        = 0.0075                                 # 2~7번칸: 보유 중 최저매수가 × (1 − 0.75%)
TP         = {'BOTTOM': 0.010, 'TOP': 0.025}        # 익절률 (매수 시점 레짐을 끝까지 유지)
MAX_DAYS   = 7                                      # 시간손절 (거래일)

# 레짐
RSI_LEN, RSI_MID = 14, 50                           # QQQ 주봉 Wilder RSI, 50 이하 BOTTOM

INIT = 100_000.0
_HERE = os.path.dirname(os.path.abspath(__file__))
_DATA = os.path.join(_HERE, '..', 'data')


# ──────────────────────────────────────────────────────────────
# 데이터
# ──────────────────────────────────────────────────────────────
def load(soxl_csv=None, regime_csv=None, soxs_csv=None):
    """SOXL 바에 MA(정배열 단기/장기)·MA200(돌파 필터)·레짐·주봉RSI 를 붙이고, 같은 날짜의 SOXS 바를 b['x'] 로 매단다.
       SOXS 파일이 없으면 b['x'] 는 None 이 되고 SOXS 돌파는 자동으로 꺼진다.
       레짐 CSV 의 각 행은 이미 '전주 금요일 확정치'라 그날 그대로 쓰면 된다."""
    soxl_csv   = soxl_csv   or os.path.join(_DATA, 'SOXL_OHLC.csv')
    regime_csv = regime_csv or os.path.join(_DATA, 'qqq_regime.csv')
    soxs_csv   = soxs_csv   or os.path.join(_DATA, 'SOXS_OHLC.csv')
    B = []
    for r in csv.DictReader(open(soxl_csv)):
        y, m, d = map(int, r['Date'].strip().split('-'))
        B.append(dict(d=date(y, m, d), o=float(r['Open']), h=float(r['High']),
                      l=float(r['Low']), c=float(r['Close'])))
    reg, rsi = {}, {}
    for r in csv.DictReader(open(regime_csv)):
        y, m, d = map(int, r['Date'].strip().split('-'))
        reg[date(y, m, d)] = r['Regime'].strip()
        try:    rsi[date(y, m, d)] = float(r['RSI'])
        except (KeyError, ValueError): pass
    X = {}
    if os.path.exists(soxs_csv):
        for r in csv.DictReader(open(soxs_csv)):
            y, m, d = map(int, r['Date'].strip().split('-'))
            X[date(y, m, d)] = dict(o=float(r['Open']), h=float(r['High']),
                                    l=float(r['Low']), c=float(r['Close']))
    def sma(n):
        out, acc = [], 0.0
        for i, b in enumerate(B):
            acc += b['c']
            if i >= n: acc -= B[i - n]['c']
            out.append(acc / n if i >= n - 1 else None)
        return out
    MA, MF, MS = sma(MA_LEN), sma(MA_FAST), sma(MA_SLOW)
    for i, b in enumerate(B):
        b['ma']   = MA[i]                             # 돌파 필터 (항상 MA_LEN)
        b['maF']  = MF[i]                             # 정배열 단기선
        b['maS']  = MS[i]                             # 정배열 장기선
        b['rg']   = reg.get(b['d'], 'TOP')
        b['rsi']  = rsi.get(b['d'])
        b['x']    = X.get(b['d'])
    return B


def target_w(p):
    """전일 바 p 로 다음 거래일 돌파 목표비중을 판정한다 (문서 §2)."""
    if not DYNAMIC_W or p['maF'] is None or p['maS'] is None:
        return W_BASE
    return W_STRONG if p['c'] > p['maF'] > p['maS'] else W_BASE


# ──────────────────────────────────────────────────────────────
# 슬리브
# ──────────────────────────────────────────────────────────────
class Breakout:
    """전량 롱/현금. 최대 1일 보유. 보유 종목은 s.tick ('SOXL' 또는 'SOXS')."""
    def __init__(s, cash):
        s.cash, s.sh, s.px, s.tick = cash, 0.0, 0.0, None
        s.trades = {'SOXL': [], 'SOXS': []}      # 청산된 트레이드의 수익률
        s.fills  = {'SOXL': 0, 'SOXS': 0}        # 체결(진입) 건수
    def flat(s):        return s.sh == 0
    def mv(s, pl, ps):  return 0.0 if s.sh == 0 else s.sh * (pl if s.tick == 'SOXL' else ps)
    def eq(s, pl, ps):  return s.cash + s.mv(pl, ps)

    def exit_open(s, B, i):
        """1) 전일 매수분 LOO 청산 — 산 종목의 시가로. 리밸런싱보다 먼저 일어난다."""
        if s.sh == 0:
            return
        bar = B[i] if s.tick == 'SOXL' else B[i]['x']
        s.cash += s.sh * bar['o'] * (1 - FEE)
        s.trades[s.tick].append(bar['o'] / s.px - 1)
        s.sh = 0.0; s.tick = None

    def _order(s, bar, prev, k, band, tick, cap=None):
        """자동감시주문(스톱-리밋). 감시가·지정가·수량 모두 전일 데이터로 확정됨.
           수량은 체결가가 아니라 지정가 기준으로 잡는다 (문서 §3.3) — 실제 체결가는
           지정가 이하이므로 프리장에 확보한 현금을 넘지 않는다."""
        T = prev['c'] + k * (prev['h'] - prev['l'])
        LMT = T * (1 + band)
        budget = s.cash if cap is None else min(s.cash, cap)
        if budget < MIN_TRADE:
            return
        q = budget / (LMT * (1 + FEE))         # 프리장에 확정되는 주문수량
        if bar['h'] <= T:
            return
        fill = None
        if bar['o'] >= T:                     # 시가가 이미 감시가 위 = 갭
            if bar['o'] <= LMT:   fill = bar['o']     # 갭이 밴드 안 → 체결
            elif bar['l'] <= LMT: fill = LMT          # 되돌아오면 체결
            # 갭이 지정가 초과 → 미체결 (추격 차단)
        else:
            fill = LMT                        # 장중 정상 돌파 (밴드 상단 가정, 보수적)
        if fill is None:
            return
        s.sh = q; s.px = fill; s.tick = tick
        s.cash -= q * fill * (1 + FEE)
        s.fills[tick] += 1

    def enter(s, B, i, total=None):
        """프리장에서 방향을 하나만 고른다. 두 조건은 배타적이다."""
        b, p = B[i], B[i - 1]
        if p['ma'] is None:                   # MA200 이 아직 없으면 어느 쪽도 주문하지 않는다
            return
        if p['c'] > p['ma']:                  # 상승 추세 → SOXL 돌파
            s._order(b, p, BO_K, BO_BAND, 'SOXL')
            return
        # 하락 추세 + QQQ 주봉 RSI ≤ 45 → SOXS 돌파 (SOXL 이 쉬는 날에만)
        if BOS_ON and b['rsi'] is not None and b['rsi'] <= BOS_RSI and b['x'] and p['x']:
            cap = None if total is None else total * BOS_MAX_W
            s._order(b['x'], p['x'], BOS_K, BOS_BAND, 'SOXS', cap)


class Grid:
    """7칸 사다리. 진입·청산 모두 종가(LOC/MOC).
       매수 수량은 프리장 가용현금과 LOC 지정가만으로 계산한다 (문서 §5.4/§5.8) —
       같은 날 청산될 매도대금은 재원에 포함하지 않는다."""
    def __init__(s, cash):
        s.cash, s.pos, s.ptr, s.trades = cash, [], 0, []
    def sh(s):       return sum(p['q'] for p in s.pos)
    def eq(s, px):   return s.cash + s.sh() * px

    def step(s, B, i):
        b, p = B[i], B[i - 1]
        c, rg = b['c'], b['rg']
        W = W_TOP if rg == 'TOP' else W_BOTTOM
        # 1) 진입 — LOC 매수 1건. 지정가·수량 모두 프리장에 확정됨
        if s.ptr < N_GRID:
            lvl = p['c'] * (1 - G1_DROP) if not s.pos \
                  else min(x['px'] for x in s.pos) * (1 - EPS)
            gassets = s.cash + s.sh() * p['c']        # 프리장 기준 그리드 자산 (전일 종가)
            budget  = min(gassets * W[s.ptr], s.cash / (1 + FEE))
            if budget >= MIN_TRADE:
                q = budget / lvl                      # 수량은 LOC 지정가 기준
                if c <= lvl:                          # 종가가 지정가 이하 → 체결
                    s.cash -= q * c * (1 + FEE)       # 실제 체결가는 당일 종가
                    s.pos.append(dict(q=q, px=c, day=i, tp=TP[rg], rg=rg, no=s.ptr + 1))
                    s.ptr += 1
        # 2) 청산 — 칸별 LOC 익절 / MOC 시간손절
        keep = []
        for x in s.pos:
            if c / x['px'] - 1 >= x['tp'] or i - x['day'] >= MAX_DAYS:
                s.cash += x['q'] * c * (1 - FEE)
                s.trades.append(c / x['px'] - 1)
            else:
                keep.append(x)
        s.pos = keep
        if not s.pos:
            s.ptr = 0                        # 전량 청산되면 사다리 리셋


# ──────────────────────────────────────────────────────────────
# 포트폴리오
# ──────────────────────────────────────────────────────────────
def run(B, i0=1, w_bo=None):
    """일일 순서 (문서 §6): LOO 청산 → 목표비중 판정 → 현금 이동 → 돌파 주문 → 그리드.
       w_bo 를 주면 그 값으로 고정, 생략하면 정배열 판정으로 매일 전환한다."""
    w0 = W_BASE if w_bo is None else w_bo
    bo, g = Breakout(INIT * w0), Grid(INIT * (1 - w0))
    eq, gross = [], []
    for i in range(i0, len(B)):
        wt = target_w(B[i - 1]) if w_bo is None else w_bo
        bo.exit_open(B, i)                            # 1) 돌파 포지션은 매일 아침 현금이 된다
        pos  = g.sh() * B[i]['o']                     # 2) 그리드 보유주식은 팔지 않는다
        pool = bo.cash + g.cash
        tot  = pool + pos
        want = max(0.0, min(pool, tot * (1 - wt) - pos))
        g.cash, bo.cash = want, pool - want           # 3) 현금만 이동해 목표비중 복원
        if wt > 0:
            bo.enter(B, i, total=tot)                 # 4) 방향 하나만 골라 감시주문
        g.step(B, i)                                  # 5) 그리드 LOC/MOC
        cl = B[i]['c']
        cs = B[i]['x']['c'] if B[i]['x'] else cl
        v = bo.eq(cl, cs) + g.eq(cl)
        eq.append((B[i]['d'], v))
        gross.append((bo.mv(cl, cs) + g.sh() * cl) / v if v > 0 else 0.0)
    return eq, bo, g, max(gross)


def stats(eq):
    v0 = INIT
    peak, mdd, uw, mx = eq[0][1], 0.0, 0, 0
    for _, v in eq:
        if v >= peak: peak, uw = v, 0
        else:
            uw += 1; mx = max(mx, uw); mdd = min(mdd, v / peak - 1)
    yrs = (eq[-1][0] - eq[0][0]).days / 365.25
    cagr = (eq[-1][1] / v0) ** (1 / yrs) - 1
    return dict(cagr=cagr, mdd=mdd, calmar=cagr / abs(mdd), maxuw=mx,
                final=eq[-1][1], yrs=yrs)


def annual(eq):
    out, prev, last = {}, INIT, {}
    for d, v in eq: last[d.year] = v
    for y in sorted(last):
        out[y] = last[y] / prev - 1; prev = last[y]
    return out


def annual_mdd(eq):
    """연도 내 최대낙폭 (문서 §8 과 같은 정의: 해당 연도 안에서만 고점 갱신)."""
    out, peak, cur = {}, {}, {}
    for d, v in eq:
        y = d.year
        if y not in peak: peak[y], cur[y] = v, 0.0
        peak[y] = max(peak[y], v)
        cur[y]  = min(cur[y], v / peak[y] - 1)
    for y in cur: out[y] = cur[y]
    return out


def index_of_year(B, y):
    return next(i for i in range(1, len(B)) if B[i]['d'].year >= y)


# ──────────────────────────────────────────────────────────────
# 다음 거래일 주문 (주문 페이지 dist/spec.js 와 동일한 계산)
# ──────────────────────────────────────────────────────────────
def next_orders(B, bo_cash, grid_cash, bo_shares, lots, regime=None, bo_tick='SOXL',
                last_rung=None):
    """lots: [{'px':매수가,'q':수량,'day_index':데이터행번호,'rg':'TOP'|'BOTTOM','no':칸번호}, ...]
       bo_tick: 돌파 슬리브가 지금 들고 있는 종목 ('SOXL' 또는 'SOXS')
       last_rung: 이번 사이클에서 마지막으로 매수한 칸 번호 (§5.7).
                  생략하면 보유 중 최대 칸번호를 쓴다 — 중간 칸이 먼저 청산된
                  경우에는 실제 진행 칸보다 작아지므로 호출자가 넘겨주는 편이 정확하다.
       bo_shares 는 다음날 시가에 청산되므로 리밸런싱 재원에 포함한다."""
    last = B[-1]
    rg = regime or last['rg']
    bo_px = last['c'] if (bo_tick == 'SOXL' or not last['x']) else last['x']['c']
    gpos  = sum(x['q'] for x in lots) * last['c']
    wt = target_w(last)

    # 리밸런싱 — 시가 청산 후 현금만 이동 (돌파 보유분은 청산 예정액으로 잡는다).
    # 매도수수료를 뺀 실입금액이 실제 재원이므로 총자산도 같은 기준으로 센다.
    pool  = bo_cash + grid_cash + bo_shares * bo_px * (1 - FEE)
    total = pool + gpos
    o = {'기준종가일': last['d'], '레짐': rg, '총자산': total,
         '정배열': wt == W_STRONG, '목표비중': wt}

    wantG = max(0.0, min(pool, total * (1 - wt) - gpos))
    o['리밸런싱'] = {'돌파현금': pool - wantG, '그리드현금': wantG,
                    '이동액': abs((pool - wantG) - bo_cash)}
    bo_avail = pool - wantG
    g_avail  = wantG

    # 돌파 — 프리장에서 방향 하나만 선택
    def _bo(bar, k, band, tick, cap=None):
        T = bar['c'] + k * (bar['h'] - bar['l'])
        L = T * (1 + band)
        amt = bo_avail if cap is None else min(bo_avail, cap)
        return {'종목': tick, '감시가': T, '지정가': L, '투입한도': amt,
                '수량': int(amt / (L * (1 + FEE)))}

    if last['ma'] is None:
        o['돌파'] = None
    elif last['c'] > last['ma']:
        o['돌파'] = _bo(last, BO_K, BO_BAND, 'SOXL')
    elif BOS_ON and last['rsi'] is not None and last['rsi'] <= BOS_RSI and last['x']:
        o['돌파'] = _bo(last['x'], BOS_K, BOS_BAND, 'SOXS', total * BOS_MAX_W)
    else:
        o['돌파'] = None

    # 그리드 진입 — 프리장 가용현금과 LOC 지정가로만 계산
    # 전량 청산되면 사이클이 리셋되어 1번 칸부터 다시 시작한다 (§5.7)
    if not lots:
        ptr = 0
    elif last_rung is not None:
        ptr = int(last_rung)
    else:
        ptr = max(x['no'] for x in lots)
    if ptr < N_GRID:
        W = W_TOP if rg == 'TOP' else W_BOTTOM
        lvl = last['c'] * (1 - G1_DROP) if not lots \
              else min(x['px'] for x in lots) * (1 - EPS)
        geq = g_avail + gpos
        bud = min(geq * W[ptr], g_avail / (1 + FEE))
        o['그리드진입'] = {'칸': ptr + 1, '비중': W[ptr], '지정가': lvl,
                          '금액': bud, '수량': int(bud / lvl)}
    else:
        o['그리드진입'] = None

    # 그리드 청산
    li = len(B) - 1
    ex = []
    for x in sorted(lots, key=lambda z: z['no']):
        held = li - x['day_index']
        forced = held + 1 >= MAX_DAYS
        ex.append({'칸': x['no'], '매수가': x['px'], '수량': x['q'], '레짐': x['rg'],
                   '경과거래일': held + 1, '주문': 'MOC 매도 (시간손절)' if forced
                   else 'LOC 매도', '지정가': None if forced else x['px'] * (1 + TP[x['rg']])})
    o['그리드청산'] = ex
    return o
