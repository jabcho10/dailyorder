# -*- coding: utf-8 -*-
"""data/*.csv -> soxl-daily-orders-source/dist/data.js

주문 페이지가 오프라인에서도 동작하도록 최신 구간만 잘라 내보낸다.
MA200 계산에 200봉이 필요하므로 여유를 둬서 260봉을 담는다.
CSV 를 갱신했으면 이 스크립트를 다시 돌려 페이지 데이터를 맞출 것.
"""
import csv, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
DIST = os.path.join(HERE, '..', 'soxl-daily-orders-source', 'dist')
OUT  = os.path.join(DIST, 'data.js')      # 오프라인 폴백 (<script> 로 로드)
OUT_JSON = os.path.join(DIST, 'data.json')  # 런타임 자동 갱신용 (fetch)
KEEP = 260


def bars(path):
    out = []
    for r in csv.DictReader(open(path)):
        out.append([r['Date'].strip(), float(r['Open']), float(r['High']),
                    float(r['Low']), float(r['Close'])])
    return out


def fmt(rows):
    return ',\n'.join(
        '  ["%s",%s]' % (r[0], ','.join(f'{v:.6f}'.rstrip('0').rstrip('.') for v in r[1:]))
        for r in rows)


soxl = bars(os.path.join(DATA, 'SOXL_OHLC.csv'))[-KEEP:]
soxs = bars(os.path.join(DATA, 'SOXS_OHLC.csv'))[-KEEP:]

reg = list(csv.DictReader(open(os.path.join(DATA, 'qqq_regime.csv'))))[-1]
qqq = {'date': reg['Date'].strip(), 'weekEnd': reg['WeekEnd'].strip(),
       'rsi': float(reg['RSI']), 'regime': reg['Regime'].strip()}

if soxl[-1][0] != soxs[-1][0]:
    raise SystemExit(f'SOXL/SOXS 마지막 날짜 불일치: {soxl[-1][0]} vs {soxs[-1][0]}')
if qqq['date'] != soxl[-1][0]:
    raise SystemExit(f'레짐/SOXL 마지막 날짜 불일치: {qqq["date"]} vs {soxl[-1][0]}')

js = f'''// 자동 생성 — engine/build_page_data.py 로 다시 만든다. 직접 수정하지 말 것.
// 생성 기준일 {soxl[-1][0]} · SOXL {len(soxl)}봉 / SOXS {len(soxs)}봉
// 각 행: [날짜, 시가, 고가, 저가, 종가]
window.SEED = {{
 soxl: [
{fmt(soxl)}
 ],
 soxs: [
{fmt(soxs)}
 ],
 qqq: {json.dumps(qqq, ensure_ascii=False)}
}};
'''
os.makedirs(DIST, exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(js)

# 페이지가 런타임에 받아가는 쪽. JS 가 아니라 JSON 이라 원격에서 코드가 실행되지 않는다.
#
# 빌드 시각은 일부러 넣지 않는다. 매 실행마다 바뀌면 새 거래일이 없는 날에도
# diff 가 생겨 휴장일마다 빈 커밋이 쌓인다. 페이지의 신선도 판정은 asOf 로 하고,
# 실제 빌드 시각은 커밋 타임스탬프에 남는다.
payload = {'asOf': soxl[-1][0], 'soxl': soxl, 'soxs': soxs, 'qqq': qqq}
json.dump(payload, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

for p in (OUT, OUT_JSON):
    print(f'{p}  {os.path.getsize(p):,} bytes')
print(f'  SOXL {len(soxl)}봉  SOXS {len(soxs)}봉  기준일 {soxl[-1][0]}  '
      f'RSI {qqq["rsi"]} ({qqq["regime"]})')
