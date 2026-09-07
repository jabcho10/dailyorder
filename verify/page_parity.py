# -*- coding: utf-8 -*-
"""주문 페이지(dist/spec.js) 대조용 기대값 생성.

engine/strategy.py 의 next_orders() 로 여러 시나리오의 주문을 계산해
verify/_parity_expected.json 으로 내보낸다. 그 다음 page_parity.js 가
같은 시나리오를 spec.js 로 계산해 두 값을 대조한다.

  python verify/page_parity.py && node verify/page_parity.js
"""
import os, sys, json
from datetime import date

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, '..', 'engine'))
import strategy as S
from strategy import load, next_orders

B = load()

# 페이지에 실린 시드와 같은 구간만 쓴다 (dist/data.js = 최근 260봉)
KEEP = 260
BW = B[-KEEP:]


def bar_index(d):
    for i, b in enumerate(BW):
        if b['d'].isoformat() == d:
            return i
    raise KeyError(d)


def lots(spec):
    """spec: [(칸번호, 매수가, 수량, 'YYYY-MM-DD', 레짐), ...]"""
    return [{'no': n, 'px': px, 'q': q, 'day_index': bar_index(d), 'rg': rg}
            for n, px, q, d, rg in spec]


DATES = [b['d'].isoformat() for b in BW]

SCENARIOS = [
    dict(name='정배열 아님 · 보유 없음 · TOP',
         cash=100000.0, bo_shares=0, bo_tick='SOXL', regime='TOP',
         lots=[], last_rung=0),
    dict(name='보유 없음 · BOTTOM 레짐',
         cash=100000.0, bo_shares=0, bo_tick='SOXL', regime='BOTTOM',
         lots=[], last_rung=0),
    dict(name='그리드 3칸 보유 · TOP',
         cash=42000.0, bo_shares=0, bo_tick='SOXL', regime='TOP',
         lots=[(1, 130.0, 90, DATES[-6], 'TOP'),
               (2, 126.5, 70, DATES[-4], 'TOP'),
               (3, 122.0, 55, DATES[-2], 'TOP')], last_rung=3),
    dict(name='중간 칸 청산 후 진행 (1,2 보유 · 마지막 매수 4번)',
         cash=30000.0, bo_shares=0, bo_tick='SOXL', regime='BOTTOM',
         lots=[(1, 130.0, 90, DATES[-9], 'TOP'),
               (2, 126.5, 70, DATES[-8], 'BOTTOM')], last_rung=4),
    dict(name='강제청산 임박 (7거래일째)',
         cash=15000.0, bo_shares=0, bo_tick='SOXL', regime='TOP',
         lots=[(1, 140.0, 60, DATES[-7], 'TOP'),
               (2, 133.0, 50, DATES[-3], 'BOTTOM')], last_rung=2),
    dict(name='전일 SOXL 돌파 보유 · 시가 청산 예정',
         cash=20000.0, bo_shares=150, bo_tick='SOXL', regime='TOP',
         lots=[(1, 128.0, 80, DATES[-5], 'TOP')], last_rung=1),
    dict(name='7칸 모두 보유 · 신규 진입 없음',
         cash=2000.0, bo_shares=0, bo_tick='SOXL', regime='TOP',
         lots=[(i, 140.0 - i * 3, 30, DATES[-8 + i], 'TOP') for i in range(1, 8)],
         last_rung=7),
    dict(name='현금 부족 · 목표금액이 현금에 구속',
         cash=1200.0, bo_shares=0, bo_tick='SOXL', regime='TOP',
         lots=[(1, 130.0, 200, DATES[-6], 'TOP')], last_rung=1),
]

out = []
for sc in SCENARIOS:
    # 페이지는 총 가용현금 하나만 받는다 -> 전액을 그리드 현금으로 넣고 재분배시킨다
    o = next_orders(BW, 0.0, sc['cash'], sc['bo_shares'], lots(sc['lots']),
                    regime=sc['regime'], bo_tick=sc['bo_tick'],
                    last_rung=sc['last_rung'])
    bo = o['돌파']; ge = o['그리드진입']
    out.append({
        'name': sc['name'],
        'input': {
            'cash': sc['cash'], 'boQty': sc['bo_shares'], 'boTick': sc['bo_tick'],
            'regime': sc['regime'], 'lastRung': sc['last_rung'],
            'lots': [{'no': n, 'px': px, 'qty': q, 'date': d, 'regime': rg}
                     for n, px, q, d, rg in sc['lots']],
        },
        'expect': {
            'total': o['총자산'], 'targetW': o['목표비중'], 'strong': o['정배열'],
            'boCash': o['리밸런싱']['돌파현금'], 'gridCash': o['리밸런싱']['그리드현금'],
            'breakout': None if not bo else {
                'ticker': bo['종목'], 'watch': bo['감시가'], 'limit': bo['지정가'],
                'budget': bo['투입한도'], 'qty': bo['수량']},
            'gridEntry': None if not ge else {
                'rung': ge['칸'], 'weight': ge['비중'], 'limit': ge['지정가'],
                'amount': ge['금액'], 'qty': ge['수량']},
            'gridExits': [{'no': x['칸'], 'limit': x['지정가'], 'elapsed': x['경과거래일'],
                           'forced': x['주문'].startswith('MOC')}
                          for x in o['그리드청산']],
        }
    })

payload = {
    'asOf': BW[-1]['d'].isoformat(),
    'rsi': BW[-1]['rsi'],
    'params': {'W_BASE': S.W_BASE, 'W_STRONG': S.W_STRONG, 'BO_K': S.BO_K,
               'BOS_K': S.BOS_K, 'BOS_RSI': S.BOS_RSI, 'BOS_MAX_W': S.BOS_MAX_W,
               'G1_DROP': S.G1_DROP, 'EPS': S.EPS, 'MAX_DAYS': S.MAX_DAYS,
               'TP_TOP': S.TP['TOP'], 'TP_BOTTOM': S.TP['BOTTOM'],
               'W_TOP': S.W_TOP, 'W_BOTTOM': S.W_BOTTOM},
    'cases': out,
}
p = os.path.join(H, '_parity_expected.json')
json.dump(payload, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'기대값 {len(out)}건 -> {p}')
print(f'기준일 {payload["asOf"]}  RSI {payload["rsi"]}')
print('이어서:  node verify/page_parity.js')
