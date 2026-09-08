# -*- coding: utf-8 -*-
"""백테스트 페이지 대조용 기대값 생성.

engine/strategy.py 의 run() 을 여러 구간·설정으로 돌려 성과지표를 적어둔다.
page_backtest.js 가 dist/backtest.js 로 같은 구간을 돌려 대조한다.

백테스트 페이지는 CSV 전체를 브라우저에서 다시 돌린다. 그 결과가 파이썬 엔진과
어긋나면 페이지의 수치가 문서·주문과 다른 전략을 보여주게 되므로 여기서 막는다.
"""
import os, sys, json

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, '..', 'engine'))
import strategy as S
from strategy import load, run, stats, annual, annual_mdd, index_of_year

B = load()

# 검사 구간 — 전체 / 문서 기준 구간 / 최근 구간 / 짧은 구간
CASES = [
    {'name': '전체 · 동적 30:70',   'i0': 1,                     'i1': None, 'w': None, 'bos': True},
    {'name': '2016~ · 동적 30:70',  'i0': index_of_year(B, 2016), 'i1': None, 'w': None, 'bos': True},
    {'name': '전체 · 고정 20:80',   'i0': 1,                     'i1': None, 'w': S.W_BASE, 'bos': True},
    {'name': '전체 · SOXS 없이',    'i0': 1,                     'i1': None, 'w': None, 'bos': False},
    {'name': '전체 · 그리드 단독',  'i0': 1,                     'i1': None, 'w': 0.0,  'bos': True},
    {'name': '2020~2022 구간',      'i0': index_of_year(B, 2020),
     'i1': index_of_year(B, 2023) - 1, 'w': None, 'bos': True},
    {'name': '최근 250봉',          'i0': len(B) - 250,          'i1': None, 'w': None, 'bos': True},
]


def trade_stat(rets):
    if not rets:
        return {'n': 0}
    return {'n': len(rets), 'win': sum(1 for r in rets if r > 0) / len(rets),
            'avg': sum(rets) / len(rets), 'best': max(rets), 'worst': min(rets)}


out = []
for c in CASES:
    i1 = len(B) - 1 if c['i1'] is None else c['i1']
    S.BOS_ON = c['bos']
    eq, bo, g, mg = run(B[:i1 + 1], c['i0'], w_bo=c['w'])
    S.BOS_ON = True
    st = stats(eq)
    out.append({
        'name': c['name'], 'i0': c['i0'], 'i1': i1, 'w': c['w'], 'bos': c['bos'],
        'from': eq[0][0].isoformat(), 'to': eq[-1][0].isoformat(), 'days': len(eq),
        'cagr': st['cagr'], 'mdd': st['mdd'], 'calmar': st['calmar'],
        'maxuw': st['maxuw'], 'final': st['final'], 'maxGross': mg,
        'annual': [{'year': str(y), 'ret': r} for y, r in sorted(annual(eq).items())],
        'annualMdd': [{'year': str(y), 'mdd': m} for y, m in sorted(annual_mdd(eq).items())],
        'soxl': trade_stat(bo.trades['SOXL']), 'soxs': trade_stat(bo.trades['SOXS']),
        'grid': trade_stat(g.trades),
    })

# 매수 후 보유 — 페이지 비교군과 같은 방식으로 만든다
i0 = 1
sh = S.INIT / B[i0]['o']
bh = [(b['d'], sh * b['c']) for b in B[i0:]]
bst = stats(bh)
payload = {
    'init': S.INIT, 'bars': len(B),
    'first': B[0]['d'].isoformat(), 'last': B[-1]['d'].isoformat(),
    'cases': out,
    'buyhold': {'i0': i0, 'cagr': bst['cagr'], 'mdd': bst['mdd'], 'final': bst['final']},
}
p = os.path.join(H, '_backtest_expected.json')
json.dump(payload, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(out)} 케이스  {B[0]["d"]} ~ {B[-1]["d"]} ({len(B)}봉) -> {p}')
for c in out:
    print(f'  {c["name"]:<20} {c["from"]}~{c["to"]}  CAGR {c["cagr"]*100:>7.2f}%  '
          f'MDD {c["mdd"]*100:>7.2f}%  최종 {c["final"]:>14,.0f}')
print('이어서:  node verify/page_backtest.js')
