# -*- coding: utf-8 -*-
"""하루치 정산 대조용 기대값 생성.

engine/strategy.py 의 run() 을 페이지가 실은 구간에서 다시 돌리면서
매일 어떤 체결이 있었는지 기록한다. page_settle.js 가 같은 구간을
SPEC.settleDay() 로 하루씩 이어 돌려 대조한다.
"""
import os, sys, json

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, '..', 'engine'))
import strategy as S
from strategy import load

B = load()
KEEP = 260                       # dist/data.js 와 같은 구간
BW = B[-KEEP:]
WARM = S.MA_LEN + 2              # MA200 이 서는 지점부터
START = WARM

bo = S.Breakout(0.0)
g = S.Grid(0.0)
cash = 100000.0                  # 두 슬리브 합산 현금 하나로 다룬다 (페이지와 동일)
last_rung = 0
steps = []


def lots_json(pos, base):
    return [{'no': p['no'], 'px': p['px'], 'qty': p['q'],
             'date': BW[p['day']]['d'].isoformat(),
             'regime': p['rg']} for p in pos]


start_state = {'cash': cash, 'lots': [], 'lastRung': 0, 'boTicker': None, 'boQty': 0}

for i in range(START, len(BW)):
    bar, prev = BW[i], BW[i - 1]
    fills = []

    # 1) 그 아침의 주문 — 프리장 시점이라 시가를 모른다.
    #    청산대금은 전일 종가로 '추정'해서 수량을 잡는다 (페이지와 동일).
    lots = [{'px': p['px'], 'q': p['q'], 'day_index': p['day'], 'rg': p['rg'], 'no': p['no']}
            for p in g.pos]
    o = S.next_orders(BW[:i], 0.0, cash, bo.sh, lots, regime=bar['rg'],
                      bo_tick=(bo.tick or 'SOXL'), last_rung=last_rung)

    # 2) 장 시작 — 전일 돌파분 MOO 청산 (실제 시가로 대금이 들어온다)
    if bo.sh > 0:
        px = bar['o'] if bo.tick == 'SOXL' else bar['x']['o']
        cash += bo.sh * px * (1 - S.FEE)
        fills.append({'kind': 'bo-exit', 'qty': bo.sh, 'price': px})
        bo.sh = 0.0; bo.tick = None
    gcash = o['리밸런싱']['그리드현금']
    bocash = o['리밸런싱']['돌파현금']

    # 3) 돌파 체결 판정
    b = o['돌파']
    if b and b['수량'] > 0:
        tick = b['종목']
        cb = bar if tick == 'SOXL' else bar['x']
        T, L = b['감시가'], b['지정가']
        fill = None
        if cb and cb['h'] > T:
            if cb['o'] >= T:
                if cb['o'] <= L: fill = cb['o']
                elif cb['l'] <= L: fill = L
            else: fill = L
        if fill is not None:
            q = b['수량']
            cash -= q * fill * (1 + S.FEE)
            bo.sh = q; bo.px = fill; bo.tick = tick
            fills.append({'kind': 'bo-entry', 'qty': q, 'price': fill})

    # 4) 그리드 신규 매수 (프리장 현금 기준)
    ge = o['그리드진입']
    if ge and ge['수량'] > 0 and bar['c'] <= ge['지정가']:
        q = ge['수량']
        cash -= q * bar['c'] * (1 + S.FEE)
        g.pos.append(dict(q=q, px=bar['c'], day=i, tp=S.TP[bar['rg']], rg=bar['rg'], no=ge['칸']))
        last_rung = ge['칸']
        fills.append({'kind': 'grid-buy', 'qty': q, 'price': bar['c']})

    # 5) 그리드 청산
    keep = []
    for p in g.pos:
        if p['day'] == i: keep.append(p); continue
        tp_hit = bar['c'] / p['px'] - 1 >= p['tp']
        forced = i - p['day'] >= S.MAX_DAYS
        if tp_hit or forced:
            cash += p['q'] * bar['c'] * (1 - S.FEE)
            fills.append({'kind': 'grid-tp' if tp_hit else 'grid-moc',
                          'qty': p['q'], 'price': bar['c']})
        else: keep.append(p)
    g.pos = keep
    if not g.pos: last_rung = 0

    if i == START:
        start_state = {'cash': 100000.0, 'lots': [], 'lastRung': 0,
                       'boTicker': None, 'boQty': 0}
    steps.append({'date': bar['d'].isoformat(), 'rsi': bar['rsi'], 'fills': fills})

end = {'cash': cash, 'lots': lots_json(g.pos, BW), 'lastRung': last_rung,
       'boTicker': bo.tick, 'boQty': bo.sh}
payload = {'from': BW[START]['d'].isoformat(), 'to': BW[-1]['d'].isoformat(),
           'days': len(steps), 'start': start_state, 'steps': steps, 'end': end}
p = os.path.join(H, '_settle_expected.json')
json.dump(payload, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
nf = sum(len(s['fills']) for s in steps)
print(f'{payload["from"]} ~ {payload["to"]}  {len(steps)}일  체결 {nf}건 -> {p}')
print('이어서:  node verify/page_settle.js')
