# -*- coding: utf-8 -*-
"""
QQQ 주봉 RSI 함정 검사.

Yahoo 주봉은 요청 period1 이 주 중간이면 첫 주가 잘린 채로 내려온다.
그 잘린 첫 주가 Wilder RSI 의 초기 시드값을 바꾸고, 시드는 지수적으로 감쇠하지만
완전히 사라지지 않는다. period1 을 달리 잡으면 같은 날짜의 RSI 가 달라진다는 뜻이다.

이 전략은 RSI 를 두 군데서 쓴다.
  · 레짐 (RSI<=50) -> 그리드 칸 사이즈와 익절률
  · SOXS 게이트 (RSI<=45) -> 돌파 방향 선택
따라서 라벨 일치만이 아니라 RSI 수치와 45 경계 일치까지 확인해야 한다.
(네트워크 필요)
"""
import urllib.request, json, csv, datetime as dt, os, sys

D_ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
RSI_MID, BOS_RSI = 50.0, 45.0


def wkbars(p1):
    req = urllib.request.Request(
        f'https://query1.finance.yahoo.com/v8/finance/chart/QQQ'
        f'?period1={p1}&period2=9999999999&interval=1wk',
        headers={'User-Agent': 'Mozilla/5.0'})
    j = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    adj = r['indicators']['adjclose'][0]['adjclose']
    return [(dt.datetime.fromtimestamp(t, dt.timezone.utc).date(), adj[i])
            for i, t in enumerate(r['timestamp']) if q['close'][i] is not None]


def wilder(wk, n=14):
    rsi = [None]*len(wk); ag = al = 0.0
    for i in range(1, len(wk)):
        ch = wk[i][1] - wk[i-1][1]; g = max(ch, 0); l = max(-ch, 0)
        if i <= n:
            ag += g; al += l
            if i == n:
                ag /= n; al /= n
                rsi[i] = 100.0 if al == 0 else 100 - 100/(1 + ag/al)
        else:
            ag = (ag*(n-1) + g)/n; al = (al*(n-1) + l)/n
            rsi[i] = 100.0 if al == 0 else 100 - 100/(1 + ag/al)
    return rsi


mine, mineR = {}, {}
for row in csv.DictReader(open(os.path.join(D_, 'qqq_regime.csv'))):
    d = row['Date'].strip()
    mine[d] = row['Regime'].strip()
    mineR[d] = float(row['RSI'])
dates = sorted(mine)


def check(p1):
    wk = wkbars(p1)
    rsi = wilder(wk)
    j = 0
    same_rg = same_gate = 0; diffs = []
    for d in dates:
        while j+1 < len(wk) and wk[j+1][0].isoformat() < d: j += 1
        k = j if wk[j][0].isoformat() < d else j-1
        v = rsi[k] if k >= 0 else None
        if v is None:
            continue
        rg = 'BOTTOM' if v <= RSI_MID else 'TOP'
        if rg == mine[d]: same_rg += 1
        if (v <= BOS_RSI) == (mineR[d] <= BOS_RSI): same_gate += 1
        diffs.append(abs(v - mineR[d]))
    wd = '월화수목금토일'[dt.date.fromtimestamp(p1).weekday()]
    n = len(diffs)
    print(f'  period1={dt.date.fromtimestamp(p1)}({wd})  주봉 {len(wk)}개  '
          f'마지막 3: {[str(x[0]) for x in wk[-3:]]}')
    print(f'      레짐(<=50) 일치 {same_rg}/{n} ({same_rg/n*100:.2f}%)   '
          f'SOXS 게이트(<=45) 일치 {same_gate}/{n} ({same_gate/n*100:.2f}%)')
    print(f'      RSI 절대오차  평균 {sum(diffs)/n:.4f}  최대 {max(diffs):.4f}')
    return same_rg == n and same_gate == n


REF = 1104537600        # 2005-01-01 — regime_build.py 가 쓰는 기준값

print('period1 별 주봉 정합성 검사')
print('기대: 기준값만 100% 일치하고 나머지는 어긋나야 한다 (그것이 이 함정의 증거다)')
try:
    res = {p1: check(p1) for p1 in (REF, 1230768000, 1262304000)}
except Exception as e:
    print(f'  [네트워크 실패] {e}')
    print('  ※ 이 검사는 Yahoo 조회가 필요하다. 오프라인이면 건너뛴다.')
    sys.exit(0)

others = [v for p1, v in res.items() if p1 != REF]
if not res[REF]:
    print('\n종합: [실패] 기준 period1 조차 CSV 와 어긋난다 — regime_build.py 재실행 필요')
elif all(others):
    print('\n종합: [주의] period1 을 바꿔도 전부 일치했다. 함정이 사라졌는지 '
          'Yahoo 응답 형식이 바뀌었는지 확인할 것')
else:
    print('\n종합: [OK] 기준 period1(2005-01-01) 과 CSV 가 정확히 일치하고,')
    print('      다른 period1 은 어긋난다 = 주봉 시드 함정이 여전히 존재한다.')
    print('      ※ QQQ 를 다시 받을 때는 반드시 start=2005-01-01 로 고정할 것.')
