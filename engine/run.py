# -*- coding: utf-8 -*-
"""확정 스펙 실행 -> SOXL_SOXS_breakout_grid_strategy_final.md 의 수치를 재현한다."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
from strategy import *

B = load()
I16 = index_of_year(B, 2016)


def line(lbl, eq, mg=None):
    s = stats(eq)
    print(f'{lbl:<30}{s["cagr"]*100:>8.2f}%{s["mdd"]*100:>8.2f}%{s["calmar"]:>8.2f}'
          f'{s["maxuw"]:>7}d{s["final"]:>16,.0f}' + (f'{mg*100:>9.2f}%' if mg else ''))
    return s


print('=' * 106)
print('SOXL/SOXS 확정 전략  |  정배열 30:70 / 그 외 20:80')
print(f'데이터 {B[0]["d"]} ~ {B[-1]["d"]}  ({len(B)} 거래일)')
print('=' * 106)
print(f'{"":<30}{"CAGR":>9}{"MDD":>9}{"Calmar":>8}{"maxUW":>8}{"최종자산":>16}{"최대노출":>10}')
print('-' * 106)

eq16, _, _, mg16 = run(B, I16);        line('2016~ (10.6년)', eq16, mg16)
eq, bo, g, mg    = run(B, 1);   s_dyn = line('2010~ (16.5년)', eq, mg)

print('-' * 106)
print('문서 §7 개선 단계별 성과 (2010~)')
print('-' * 106)

# 실전 제약 적용·고정 20:80
eqf, _, _, _ = run(B, 1, w_bo=W_BASE); s_fix = line('  실전형 고정 20:80', eqf)
line('  실전형 동적 30:70', eq)

# 참고: SOXS 미사용 / 돌파 미사용 / Buy&Hold
S.BOS_ON = False
eqn, _, _, _ = run(B, 1); line('  SOXS 없이 (동적 30:70)', eqn)
S.BOS_ON = True
eqg, _, _, _ = run(B, 1, w_bo=0.0); line('  그리드 단독', eqg)
sh = INIT / B[1]['o']
line('  Buy&Hold', [(b['d'], sh * b['c']) for b in B[1:]])

print(f'\n{"-"*106}\n동적 배분 기여 : CAGR {(s_dyn["cagr"]-s_fix["cagr"])*100:+.2f}%p  '
      f'MDD {(abs(s_fix["mdd"])-abs(s_dyn["mdd"]))*100:+.2f}%p 개선')

print(f'\n{"-"*106}\n돌파 슬리브 체결 내역 (2010~)\n{"-"*106}')
for tk in ['SOXL', 'SOXS']:
    t = bo.trades[tk]
    if not t:
        print(f'  {tk}  체결 없음'); continue
    wr = sum(1 for x in t if x > 0) / len(t)
    print(f'  {tk}  {len(t):>4}건 ({len(t)/s_dyn["yrs"]:>4.0f}/년)  승률 {wr*100:>5.1f}%  '
          f'평균 {sum(t)/len(t)*100:>+6.3f}%  최고 {max(t)*100:>+6.1f}%  최저 {min(t)*100:>+6.1f}%')
print(f'  그리드 청산 {len(g.trades)}건 ({len(g.trades)/s_dyn["yrs"]:.0f}/년)')

print(f'\n{"-"*106}\n연도별 수익률 / 연도 내 MDD (2010~)\n{"-"*106}')
A, M = annual(eq), annual_mdd(eq)
for y in sorted(A):
    print(f'  {y}  {A[y]*100:>+8.2f}%   {M[y]*100:>8.2f}%')

print(f'\n{"-"*106}\n문서 §10 인접 이동평균 검증 (2010~)\n{"-"*106}')
print(f'  {"단기":>4}{"장기":>6}{"CAGR":>10}{"MDD":>10}{"Calmar":>9}')
base_fast, base_slow = S.MA_FAST, S.MA_SLOW
for fast in (40, 50, 60):
    for slow in (180, 200, 220):
        S.MA_FAST, S.MA_SLOW = fast, slow
        Bx = load()
        e, _, _, _ = run(Bx, 1); st = stats(e)
        mark = ' *' if (fast, slow) == (50, 200) else ''
        print(f'  {fast:>4}{slow:>6}{st["cagr"]*100:>9.2f}%{st["mdd"]*100:>9.2f}%'
              f'{st["calmar"]:>9.2f}{mark}')
S.MA_FAST, S.MA_SLOW = base_fast, base_slow
print(f'  {"고정 20:80":>10}{s_fix["cagr"]*100:>9.2f}%{s_fix["mdd"]*100:>9.2f}%{s_fix["calmar"]:>9.2f}')
