# -*- coding: utf-8 -*-
"""
독립 재구현 검증.
engine/strategy.py 와 코드를 한 줄도 공유하지 않고
SOXL_SOXS_breakout_grid_strategy_final.md 만 보고 다시 작성한 뒤,
데이터 무결성 + 자본 보존 + 실전 제약 준수 + 결과 일치를 대조한다.
(이 검증이 실제로 엔진의 '먼지 포지션' 버그를 잡아냈다)
"""
import csv, os, sys, math
from datetime import date
H = os.path.dirname(os.path.abspath(__file__))
D_ = os.path.join(H, '..', 'data')
sys.path.insert(0, os.path.join(H, '..', 'engine'))

# ── 1. 데이터 무결성 ────────────────────────────────────────────
bars = []
for r in csv.DictReader(open(os.path.join(D_, 'SOXL_OHLC.csv'))):
    y, m, d = map(int, r['Date'].strip().split('-'))
    bars.append((date(y, m, d), float(r['Open']), float(r['High']),
                 float(r['Low']), float(r['Close']), float(r['Volume'])))
print('=' * 92); print('1. 데이터 무결성'); print('=' * 92)
bad, seen, dup, prev = [], set(), 0, None
for dt, o, h, l, c, v in bars:
    if dt in seen: dup += 1
    seen.add(dt)
    if not (l <= o <= h and l <= c <= h): bad.append((dt, 'OHLC 모순'))
    if min(o, h, l, c) <= 0: bad.append((dt, '가격 <= 0'))
    if prev and dt <= prev: bad.append((dt, '정렬 오류'))
    prev = dt
wk = [d for d, *_ in bars if d.weekday() >= 5]
gap = [(bars[i-1][0], bars[i][0]) for i in range(1, len(bars))
       if (bars[i][0] - bars[i-1][0]).days > 5]
rets = sorted(bars[i][4] / bars[i-1][4] - 1 for i in range(1, len(bars)))
print(f'  SOXL  {len(bars)}행  {bars[0][0]} ~ {bars[-1][0]}')
print(f'        중복날짜 {dup}   OHLC 위반 {len(bad)}   주말바 {len(wk)}   5일초과 공백 {len(gap)}')
print('        극단 일간수익률: ' + ', '.join(f'{x*100:.1f}%' for x in rets[:3] + rets[-3:]))

# SOXS: 자체 무결성 + SOXL 과의 역상관 정합성 (미기록 분할이 남아 있으면 여기서 걸린다)
SX = {}
for r in csv.DictReader(open(os.path.join(D_, 'SOXS_OHLC.csv'))):
    y, m, d = map(int, r['Date'].strip().split('-'))
    SX[date(y, m, d)] = (float(r['Open']), float(r['High']),
                         float(r['Low']), float(r['Close']))
sbad = [d for d, (o, h, l, c) in SX.items()
        if not (l <= min(o, c) * (1 + 1e-9) and h >= max(o, c) * (1 - 1e-9)) or min(o, h, l, c) <= 0]
smiss = [d for d, *_ in bars if d not in SX]
resid = []
for i in range(1, len(bars)):
    d0, d1 = bars[i-1][0], bars[i][0]
    if d0 in SX and d1 in SX:
        rl = bars[i][4] / bars[i-1][4] - 1
        rs = SX[d1][3] / SX[d0][3] - 1
        resid.append((abs(rl + rs), d1, rl, rs))
resid.sort(reverse=True)
med = resid[len(resid)//2][0]
print(f'  SOXS  {len(SX)}행   OHLC 위반 {len(sbad)}   SOXL 대비 결측 {len(smiss)}일')
print(f'        |rL+rS| 중앙값 {med*100:.4f}%   최대 {resid[0][0]*100:.2f}% ({resid[0][1]})')
print(f'        분할 잔재(>50%) {sum(1 for x in resid if x[0] > 0.5)}건'
      f'   {"[OK]" if not sum(1 for x in resid if x[0] > 0.5) else "[경고: fetch_soxs.py 재실행 필요]"}')

# ── 2. 독립 재구현 ─────────────────────────────────────────────
Dt = [b[0] for b in bars]; O = [b[1] for b in bars]; Hh = [b[2] for b in bars]
L = [b[3] for b in bars]; C = [b[4] for b in bars]; N = len(bars)
REG, RSI_ = {}, {}
for r in csv.DictReader(open(os.path.join(D_, 'qqq_regime.csv'))):
    y, m, d = map(int, r['Date'].strip().split('-'))
    REG[date(y, m, d)] = r['Regime'].strip()
    RSI_[date(y, m, d)] = float(r['RSI'])
RG  = [REG[d] for d in Dt]
RSI = [RSI_.get(d) for d in Dt]

def sma(n):
    out, acc = [None]*N, 0.0
    for i in range(N):
        acc += C[i]
        if i >= n: acc -= C[i-n]
        if i >= n-1: out[i] = acc/n
    return out

MA  = sma(200)      # 돌파 필터
MAF = sma(50)       # 정배열 단기선
MAS = sma(200)      # 정배열 장기선

WT = [.16, .20, .24, .28, .32, .36, .44]; WB = [w/2 for w in WT]
TPr = {'BOTTOM': .010, 'TOP': .025}
F, MIN, K, BAND, G1, EPS, MD = .001, 1.0, .7, .001, .005, .0075, 7
WBASE, WSTRONG = .20, .30           # 정배열이면 돌파 30%
SK, SBAND, SRSI, SCAP = .5, .001, 45.0, .20   # SOXS: k=0.5, RSI<=45, 전체자산 20% 상한


def sim(i0, dynamic=True):
    boC, boS, boP = 100000.0*WBASE, 0.0, 0.0
    boT = None                                  # 보유 종목: None / 'L' / 'S'
    gC, pos, ptr = 100000.0*(1-WBASE), [], 0
    eq = []; mincash = 1e18; maxgross = 0.0; boN = boSN = 0
    max_soxs_w = 0.0; overspend = 0             # 실전 제약 위반 카운터
    for i in range(i0, N):
        # (1) 전일 돌파분 LOO 청산 — 리밸런싱보다 먼저
        if boS > 0:
            op = O[i] if boT == 'L' else XOc(i)
            boC += boS*op*(1-F)
            boS = 0.0; boT = None
        # (2) 전일 종가로 목표비중 판정
        wt = WBASE
        if dynamic and MAF[i-1] is not None and MAS[i-1] is not None:
            if C[i-1] > MAF[i-1] > MAS[i-1]: wt = WSTRONG
        # (3) 현금만 이동해 목표비중 복원
        gp = sum(p[0] for p in pos) * O[i]
        tot = boC + gC + gp; pool = boC + gC
        want = max(0.0, min(pool, tot*(1-wt) - gp))
        gC, boC = want, pool - want
        cash_premkt = gC                        # 그리드 프리장 가용현금 (스냅샷)
        # (4) 돌파 — 프리장에서 방향 하나만
        if MA[i-1] is not None:
            if C[i-1] > MA[i-1]:
                q, fill = order(C[i-1] + K*(Hh[i-1]-L[i-1]), BAND, boC,
                                Hh[i], O[i], L[i])
                if fill:
                    boS, boP, boT = q, fill, 'L'; boC -= q*fill*(1+F); boN += 1
            elif (RSI[i] is not None and RSI[i] <= SRSI
                  and Dt[i] in SX and Dt[i-1] in SX):
                xo, xh, xl, xc = SX[Dt[i]]
                po, ph, pl, pc = SX[Dt[i-1]]
                q, fill = order(pc + SK*(ph-pl), SBAND, min(boC, tot*SCAP),
                                xh, xo, xl)
                if fill:
                    boS, boP, boT = q, fill, 'S'; boC -= q*fill*(1+F); boSN += 1
                    max_soxs_w = max(max_soxs_w, q*fill*(1+F)/tot)
        # (5) 그리드 — 수량은 프리장 현금과 LOC 지정가로만
        W = WT if RG[i] == 'TOP' else WB
        if ptr < 7:
            lvl = C[i-1]*(1-G1) if not pos else min(p[1] for p in pos)*(1-EPS)
            gassets = gC + sum(p[0] for p in pos)*C[i-1]     # 전일 종가 기준
            bud = min(gassets*W[ptr], gC/(1+F))
            if bud >= MIN:
                q = bud/lvl                                  # LOC 지정가 기준 수량
                if C[i] <= lvl:
                    spend = q*C[i]*(1+F)
                    if spend > cash_premkt + 1e-9: overspend += 1
                    gC -= spend
                    pos.append([q, C[i], i, TPr[RG[i]]]); ptr += 1
        nxt = []
        for p in pos:
            if C[i]/p[1]-1 >= p[3] or i-p[2] >= MD: gC += p[0]*C[i]*(1-F)
            else: nxt.append(p)
        pos = nxt
        if not pos: ptr = 0
        gq = sum(p[0] for p in pos)
        bov = 0.0 if boS == 0 else boS*(C[i] if boT == 'L' else SX[Dt[i]][3])
        v = boC + gC + gq*C[i] + bov; eq.append((Dt[i], v))
        mincash = min(mincash, boC, gC)
        maxgross = max(maxgross, (gq*C[i] + bov)/v if v > 0 else 0)
    return eq, mincash, maxgross, boN, boSN, max_soxs_w, overspend


def XOc(i):
    return SX[Dt[i]][0]


def order(T, band, budget, hi, op, lo):
    """스톱-리밋. 수량은 지정가 기준으로 프리장에 확정된다."""
    LMT = T*(1+band)
    if budget < MIN: return 0.0, None
    q = budget/(LMT*(1+F))
    if hi <= T: return 0.0, None
    fill = None
    if op >= T:
        if op <= LMT: fill = op
        elif lo <= LMT: fill = LMT
    else:
        fill = LMT
    return q, fill


def st(eq):
    peak, mdd, uw, mx = eq[0][1], 0.0, 0, 0
    for _, v in eq:
        if v >= peak: peak, uw = v, 0
        else:
            uw += 1; mx = max(mx, uw); mdd = min(mdd, v/peak-1)
    yrs = (eq[-1][0]-eq[0][0]).days/365.25
    return (eq[-1][1]/100000.0)**(1/yrs)-1, mdd, mx, eq[-1][1]

print(); print('=' * 92); print('2. 독립 재구현 vs engine/strategy.py'); print('=' * 92)
import strategy as E
B = E.load()
i16 = next(i for i in range(1, N) if Dt[i].year >= 2016)
print(f'{"기간":<14}{"":<8}{"CAGR":>9}{"MDD":>9}{"maxUW":>8}{"최종자산":>16}')
ok = True
cases = [('2016~ 동적', i16, True), ('2010~ 동적', 1, True), ('2010~ 고정20:80', 1, False)]
for lbl, i0, dyn in cases:
    eq, mc, mg, boN, boSN, msw, ovs = sim(i0, dyn); a = st(eq)
    eq2, bo2, g2, mg2 = E.run(B, i0, w_bo=(None if dyn else 0.20)); b = E.stats(eq2)
    print(f'{lbl:<14}{"독립":<8}{a[0]*100:>8.2f}%{a[1]*100:>8.2f}%{a[2]:>7}d{a[3]:>16,.0f}')
    print(f'{"":<14}{"엔진":<8}{b["cagr"]*100:>8.2f}%{b["mdd"]*100:>8.2f}%{b["maxuw"]:>7}d{b["final"]:>16,.0f}', end='')
    same = abs(a[3]/b['final']-1) < 1e-9
    nL, nS = bo2.fills['SOXL'], bo2.fills['SOXS']
    cnt = (boN == nL and boSN == nS)
    ok &= same and cnt
    print('   [일치]' if same else '   [불일치!]')
    print(f'{"":<14}체결수: 독립 SOXL {boN} / SOXS {boSN}   엔진 SOXL {nL} / SOXS {nS}  '
          f'{"[일치]" if cnt else "[불일치!]"}')
    print(f'{"":<14}자본검사: 최소현금 ${mc:,.4f}  최대총노출 {mg*100:.2f}%  '
          f'{"[OK]" if mc >= -1e-6 and mg <= 1.0000001 else "[경고]"}')
    cap_ok = msw <= SCAP + 1e-9
    ok &= cap_ok and ovs == 0
    print(f'{"":<14}실전제약: SOXS 최대투입 {msw*100:.2f}% (한도 {SCAP*100:.0f}%) '
          f'{"[OK]" if cap_ok else "[위반!]"}   '
          f'당일매도대금 선사용 {ovs}건 {"[OK]" if ovs == 0 else "[위반!]"}')

print(); print('=' * 92); print('3. 널 테스트 / 벤치마크'); print('=' * 92)
yrs = (Dt[-1]-Dt[1]).days/365.25
bh = C[-1]/O[1]
print(f'  Buy&Hold 검산: {O[1]:.6f} -> {C[-1]:.2f} = {bh:.2f}배, CAGR {(bh**(1/yrs)-1)*100:.2f}%')

# 배타성: 두 게이트가 동시에 참인 날이 없어야 한다 (프리장 방향 사전선택)
def gL(i): return MA[i-1] is not None and C[i-1] >  MA[i-1]
def gS(i): return (MA[i-1] is not None and C[i-1] <= MA[i-1]
                   and RSI[i] is not None and RSI[i] <= SRSI)
both = sum(1 for i in range(1, N) if gL(i) and gS(i))
nL   = sum(1 for i in range(1, N) if gL(i))
nS   = sum(1 for i in range(1, N) if gS(i))
prio = sum(1 for i in range(1, N)
           if gL(i) and RSI[i] is not None and RSI[i] <= SRSI)
print(f'  방향 배타성 검사: 두 게이트 동시 참 {both}건 '
      f'{"[OK]" if both == 0 else "[위반!]"}   (SOXL 주문일 {nL} / SOXS 주문일 {nS})')
print(f'  참고: RSI<=45 이지만 SOXL 이 MA200 위라 SOXL 을 낸 날 {prio}건')
ok &= both == 0
print(f'\n종합: {"모든 검증 통과" if ok else "불일치 발생 — 확인 필요"}')
