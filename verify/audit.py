# -*- coding: utf-8 -*-
"""미래참조 감사 / 비용 스트레스 / 워크포워드 / SOXS 슬리브 단독 감사 / 동적배분 감사."""
import os, sys, copy
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, '..', 'engine'))
import strategy as S
from strategy import load, run, stats, index_of_year

B = load(); I16 = index_of_year(B, 2016)

def go(i0=1, _reload=False, **kw):
    """_reload=True 면 이동평균 길이가 바뀌었으므로 데이터를 다시 만든다."""
    old = {k: getattr(S, k) for k in kw}
    for k, v in kw.items(): setattr(S, k, v)
    data = load() if _reload else B
    eq, bo, g, _ = run(data, i0); s = stats(eq); s['bo'] = bo
    for k, v in old.items(): setattr(S, k, v)
    return s, eq

print('=' * 96); print('1. 미래참조 감사 : 레짐 신호를 더 늦춰도 살아남는가'); print('=' * 96)
# 레짐(그리드 사이즈·익절률)과 주봉 RSI(SOXS 게이트)를 함께 지연시킨다
orig  = [b['rg']  for b in B]
origR = [b['rsi'] for b in B]
print(f'{"추가 지연":<14}{"2016~ CAGR/MDD":>24}{"2010~ CAGR/MDD":>24}')
for lag in [0, 5, 10, 20]:
    sh  = ([orig[0]]*lag  + orig[:-lag])  if lag else orig
    shR = ([origR[0]]*lag + origR[:-lag]) if lag else origR
    for b, r, rr in zip(B, sh, shR): b['rg'], b['rsi'] = r, rr
    a, _ = go(I16); c, _ = go(1)
    print(f'{f"+{lag}거래일":<14}{a["cagr"]*100:>15.2f}% /{a["mdd"]*100:>6.1f}%'
          f'{c["cagr"]*100:>15.2f}% /{c["mdd"]*100:>6.1f}%')
for b, r, rr in zip(B, orig, origR): b['rg'], b['rsi'] = r, rr

print(); print('=' * 96); print('2. 비용 스트레스 : 수수료를 올리면'); print('=' * 96)
print(f'{"수수료(편도)":<14}{"2016~ CAGR/MDD":>24}{"2010~ CAGR/MDD":>24}')
for f in [0.001, 0.0015, 0.002, 0.003]:
    a, _ = go(I16, FEE=f); c, _ = go(1, FEE=f)
    print(f'{f"{f*100:.2f}%":<14}{a["cagr"]*100:>15.2f}% /{a["mdd"]*100:>6.1f}%'
          f'{c["cagr"]*100:>15.2f}% /{c["mdd"]*100:>6.1f}%')

print(); print('=' * 96); print('3. 파라미터 고원 : 값을 흔들어도 유지되는가 (2010~)'); print('=' * 96)
print(f'{"돌파 k":<10}' + ''.join(f'{k:>10.1f}' for k in [0.5,0.6,0.7,0.8,0.9,1.0,1.2]))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for k in [0.5,0.6,0.7,0.8,0.9,1.0,1.2]:
    s, _ = go(1, BO_K=k); row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)
SKS = [0.3,0.4,0.5,0.6,0.7,0.9,1.1]
print(f'\n{"SOXS k":<10}' + ''.join(f'{k:>10.1f}' for k in SKS))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for k in SKS:
    s, _ = go(1, BOS_K=k); row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)

SRS = [40, 42, 45, 47, 50, 55]
print(f'\n{"SOXS RSI":<10}' + ''.join(f'{r:>10}' for r in SRS))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for r in SRS:
    s, _ = go(1, BOS_RSI=float(r)); row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)

TPS = [0.002,0.005,0.010,0.015,0.020]
print(f'\n{"BOTTOM TP":<10}' + ''.join(f'{t*100:>9.1f}%' for t in TPS))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for t in TPS:
    s, _ = go(1, TP={'BOTTOM': t, 'TOP': 0.025})
    row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)
print(f'\n{"칸 간격":<10}' + ''.join(f'{e*100:>9.2f}%' for e in [0.005,0.0075,0.01,0.015,0.02]))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for e in [0.005,0.0075,0.01,0.015,0.02]:
    s, _ = go(1, EPS=e); row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)
print(f'\n{"손절일수":<10}' + ''.join(f'{m:>9}d' for m in [5,7,10,12,15]))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for m in [5,7,10,12,15]:
    s, _ = go(1, MAX_DAYS=m); row += f'{s["cagr"]*100:>9.2f}%'; row2 += f'{s["mdd"]*100:>9.1f}%'
print(row); print(row2)
print('  ※ 손절일수만 고원이 아니다. 12일 이상에서 MDD가 급격히 나빠짐 -> 7일 고정 권장.')

print(); print('=' * 96); print('4. 워크포워드 : 2010-2017 로 고른 값이 2018-2026 에서도 통하는가'); print('=' * 96)
def seg(eq, y0, y1):
    idx = [j for j, (d, _) in enumerate(eq) if y0 <= d.year <= y1]
    s = [eq[j][1] for j in idx]; peak = s[0]; mdd = 0.0
    for v in s: peak = max(peak, v); mdd = min(mdd, v/peak-1)
    yrs = (eq[idx[-1]][0]-eq[idx[0]][0]).days/365.25
    return (s[-1]/s[0])**(1/yrs)-1, mdd
grid = []
for md in [5,7,10]:
    for eps in [0.005,0.0075,0.01,0.015]:
        for k in [0.6,0.7,0.8,0.9]:
            _, eq = go(1, MAX_DAYS=md, EPS=eps, BO_K=k)
            grid.append((seg(eq,2010,2017), seg(eq,2018,2026), md, eps, k))
ok = [x for x in grid if x[0][1] >= -0.30]
ok.sort(key=lambda x: -x[0][0])
print(f'{"순위":>5}{"손절":>6}{"간격":>9}{"k":>6}{"  인샘플 2010-17":>22}{"  아웃샘플 2018-26":>24}')
for r, (a, b, md, eps, k) in enumerate(ok[:5], 1):
    print(f'{r:>5}{md:>5}d{eps*100:>8.2f}%{k:>6.1f}{a[0]*100:>14.2f}% /{a[1]*100:>6.1f}%'
          f'{b[0]*100:>16.2f}% /{b[1]*100:>6.1f}%')
best = ok[0]
rank = sorted(ok, key=lambda x: -x[1][0]).index(best) + 1
print(f'\n  인샘플 1등 조합의 아웃샘플 순위: {rank} / {len(ok)}')
cur = [x for x in grid if x[2]==7 and abs(x[3]-0.0075)<1e-9 and abs(x[4]-0.7)<1e-9][0]
print(f'  확정 스펙(손절7/간격0.75%/k0.7): 인샘플 {cur[0][0]*100:.2f}%/{cur[0][1]*100:.1f}%'
      f'   아웃샘플 {cur[1][0]*100:.2f}%/{cur[1][1]*100:.1f}%')
print('  ※ 아웃샘플 수익률이 훨씬 높은 것은 2018년 이후 구간 자체가 좋았기 때문.')
print('     일반화된 것은 파라미터의 "순위"이지 "수익률 수준"이 아니다.')

print(); print('=' * 96); print('5. SOXS 슬리브 단독 감사'); print('=' * 96)

a, _ = go(I16, BOS_ON=False); b, _ = go(I16, BOS_ON=True)
c, _ = go(1,   BOS_ON=False); d, _ = go(1,   BOS_ON=True)
print(f'{"":<14}{"2016~ CAGR/MDD/Calmar":>32}{"2010~ CAGR/MDD/Calmar":>32}')
for lbl, x, y in [('SOXS 없음', a, c), ('SOXS 포함', b, d)]:
    print(f'{lbl:<14}'
          f'{x["cagr"]*100:>16.2f}% /{x["mdd"]*100:>6.1f}% /{x["calmar"]:>5.2f}'
          f'{y["cagr"]*100:>16.2f}% /{y["mdd"]*100:>6.1f}% /{y["calmar"]:>5.2f}')

print('\n  --- 트레이드 통계 (2010~) ---')
bo = d['bo']
for tk in ['SOXL', 'SOXS']:
    t = bo.trades[tk]
    wr = sum(1 for x in t if x > 0) / len(t)
    print(f'  {tk}  {len(t):>4}건  승률 {wr*100:>5.1f}%  평균 {sum(t)/len(t)*100:>+7.3f}%'
          f'  최고 {max(t)*100:>+6.1f}%  최저 {min(t)*100:>+6.1f}%')

print('\n  --- 꼬리 의존도: 상위 N개 트레이드를 지우면 평균이 어떻게 되나 ---')
for tk in ['SOXL', 'SOXS']:
    t = sorted(bo.trades[tk], reverse=True)
    cells = '   '.join(f'-{n}: {sum(t[n:])/len(t[n:])*100:>+6.3f}%' for n in [0, 5, 10, 20])
    print(f'  {tk}  {cells}')
print('  ※ SOXL 은 꼬리를 지워도 살아남지만 SOXS 는 상위 5건에 엣지가 몰려 있다.')
print('     SOXS 슬리브는 "평상시 거의 본전, 급락 갭에서 크게" 라는 보험형 손익구조로 봐야 한다.')

print('\n  --- RSI 게이트의 기여 (트레이드 레벨) ---')
# 포트폴리오로 비교하면 레짐이 그리드 사이즈까지 바꿔서 교란된다.
# 그래서 SOXS 진입만 따로 떼어내 RSI 구간별 손익을 본다.
def soxs_trades(k=S.BOS_K, band=S.BOS_BAND):
    out = []
    for i in range(S.MA_LEN, len(B) - 1):
        p, b = B[i-1], B[i]
        if p['ma'] is None or p['c'] > p['ma']: continue      # SOXL 이 도는 날은 제외
        if not (b['x'] and p['x']) or b['rsi'] is None: continue
        T = p['x']['c'] + k * (p['x']['h'] - p['x']['l'])
        if b['x']['h'] <= T: continue
        LMT, fill = T * (1 + band), None
        if b['x']['o'] >= T:
            if b['x']['o'] <= LMT: fill = b['x']['o']
            elif b['x']['l'] <= LMT: fill = LMT
        else: fill = LMT
        if fill is None or not B[i+1]['x']: continue
        out.append((b['rsi'], b['d'].year,
                    B[i+1]['x']['o'] * (1 - S.FEE) / (fill * (1 + S.FEE)) - 1))
    return out
TR = soxs_trades()
def show(lbl, sel):
    v = [r for rs, y, r in TR if sel(rs, y)]
    if not v: print(f'  {lbl:<24} 0건'); return
    print(f'  {lbl:<24}{len(v):>5}건  승률 {sum(1 for x in v if x>0)/len(v)*100:>5.1f}%'
          f'  평균 {sum(v)/len(v)*100:>+7.3f}%  합 {sum(v)*100:>+8.1f}%')
for th in [40, 45, 50, 55]:
    show(f'RSI<={th}' + ('  (채택)' if th == S.BOS_RSI else ''),
         lambda rs, y, t=th: rs <= t)
show('게이트 없음 = 전체', lambda rs, y: True)
show('RSI 45~50 (제외 구간)', lambda rs, y: 45 < rs <= 50)
print('  ※ 채택된 RSI<=45 가 45~50 구간을 잘라내는 것이 게이트의 핵심이다.')
print('\n  --- RSI<=45 구간 전후반 분리 ---')
show('RSI<=45  2010-2017', lambda rs, y: rs <= 45 and y < 2018)
show('RSI<=45  2018-2026', lambda rs, y: rs <= 45 and y >= 2018)

print(); print('=' * 96); print('6. 동적 배분(정배열 30:70) 감사'); print('=' * 96)
n_str = sum(1 for b in B if S.target_w(b) == S.W_STRONG)
print(f'  정배열 판정일 {n_str} / {len(B)}  ({n_str/len(B)*100:.1f}%)')
f16, _ = go(I16, DYNAMIC_W=False); d16, _ = go(I16, DYNAMIC_W=True)
f10, _ = go(1,   DYNAMIC_W=False); d10, _ = go(1,   DYNAMIC_W=True)
print(f'{"":<14}{"2016~ CAGR/MDD/Calmar":>32}{"2010~ CAGR/MDD/Calmar":>32}')
for lbl, x, y in [('고정 20:80', f16, f10), ('동적 30:70', d16, d10)]:
    print(f'{lbl:<14}'
          f'{x["cagr"]*100:>16.2f}% /{x["mdd"]*100:>6.1f}% /{x["calmar"]:>5.2f}'
          f'{y["cagr"]*100:>16.2f}% /{y["mdd"]*100:>6.1f}% /{y["calmar"]:>5.2f}')
print(f'  기여(2010~): CAGR {(d10["cagr"]-f10["cagr"])*100:+.2f}%p  '
      f'MDD {(abs(f10["mdd"])-abs(d10["mdd"]))*100:+.2f}%p 개선')

print('\n  --- 강한 상승장 비중을 흔들면 (2010~) ---')
WS = [0.20,0.25,0.30,0.35,0.40,0.50]
print(f'{"W_STRONG":<10}' + ''.join(f'{w*100:>9.0f}%' for w in WS))
row = f'{"CAGR":<10}'; row2 = f'{"MDD":<10}'
for w in WS:
    x, _ = go(1, W_STRONG=w); row += f'{x["cagr"]*100:>9.2f}%'; row2 += f'{x["mdd"]*100:>9.1f}%'
print(row); print(row2)

print('\n  --- 인접 이동평균 (문서 §10) ---')
print(f'  {"단기":>4}{"장기":>6}{"CAGR":>10}{"MDD":>10}{"Calmar":>9}')
for fast in (40, 50, 60):
    for slow in (180, 200, 220):
        x, _ = go(1, MA_FAST=fast, MA_SLOW=slow, _reload=True)
        mark = ' *' if (fast, slow) == (50, 200) else ''
        print(f'  {fast:>4}{slow:>6}{x["cagr"]*100:>9.2f}%{x["mdd"]*100:>9.2f}%'
              f'{x["calmar"]:>9.2f}{mark}')
print('  ※ 9개 조합 전부 고정 20:80 보다 CAGR·MDD 가 좋다 -> 단일 최적점이 아니라 고원.')
