# -*- coding: utf-8 -*-
"""QQQ 주봉 RSI 의 시작일 의존성 검사.

예전에는 regime_build.py 가 Yahoo 에서 interval='1wk' 로 주봉을 바로 받았다.
그때는 요청 시작일이 주 중간이면 첫 주가 잘린 채 내려오고, 그 잘린 주가
Wilder RSI 시드를 바꿀 뿐 아니라 이후 '모든' 주 경계까지 통째로 밀어버렸다.
게다가 인덱스가 주 '시작일' 이라 진행 중인 이번 주 봉이 그 주 화요일부터
쓰여 룩어헤드가 났다.

지금은 일봉을 받아 ISO 주(월~일)로 직접 접고 그 주의 마지막 거래일을
라벨로 쓴다. 그래서 주 경계와 라벨은 시작일과 완전히 무관하다.
남는 것은 Wilder RSI 의 시드 워밍업뿐이고, 이것은 지수적으로 감쇠한다.

이 검사가 확인하는 것:
  1) 주 라벨과 주간 종가가 시작일과 무관하게 같은가          (구조적 함정 제거)
  2) 시작+3년 이후 RSI 가 시작일과 무관하게 같은가            (시드 감쇠)
     -> 레짐(<=50)·SOXS 게이트(<=45) 판정이 한 건도 안 갈리는가
  3) data/qqq_regime.csv 가 기준 시작일로 새로 만든 값과 같은가

기준 시작일은 2005-01-01. SOXL 첫 거래일이 2010-03-11 이므로 실제로 쓰는
구간 전체가 5년 이상 워밍업을 거친 뒤다. (네트워크 필요)
"""
import csv, os, sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))
import ydl
import pandas as pd

D_ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
RSI_LEN, RSI_MID, BOS_RSI = 14, 50.0, 45.0
BASE = '2005-01-01'
ALTS = ['2009-01-01', '2010-01-01', '2012-06-13', '2015-03-04']   # 목·금·수·수
WARMUP_Y = 3
TOL_RSI = 1e-2            # 시드 감쇠 잔차. 실측 최대 4e-4 라 25배 여유.
TOL_CLOSE = 1e-3          # 야후 조정계수 재계산 노이즈


def weekly(start):
    """일봉 -> (주 마지막 거래일, 그 날 종가). 진행 중인 주는 뺀다."""
    raw = ydl.download('QQQ', start=start, auto_adjust=True)
    if raw is None or raw.empty:
        sys.exit('QQQ 다운로드 실패: 빈 데이터프레임')
    if hasattr(raw.columns, 'levels'):
        raw.columns = raw.columns.droplevel(1)
    raw = raw[['Close']].dropna()
    raw.index = pd.to_datetime(raw.index).tz_localize(None).normalize()
    last = raw.index[-1].date()
    wk, cl = [], []
    for p, g in raw.groupby(raw.index.to_period('W-SUN'), sort=True):
        if last < p.start_time.date() + timedelta(days=4):
            break
        wk.append(g.index[-1].date())
        cl.append(float(g['Close'].iloc[-1]))
    return wk, cl


def rsi_of(cl):
    r = [None] * len(cl)
    gs = ls = 0.0
    for i in range(1, len(cl)):
        ch = cl[i] - cl[i-1]
        g, l = max(ch, 0.0), max(-ch, 0.0)
        if i <= RSI_LEN:
            gs += g; ls += l
            if i == RSI_LEN:
                ag, al = gs/RSI_LEN, ls/RSI_LEN
                r[i] = 100.0 if al == 0 else 100 - 100/(1 + ag/al)
        else:
            ag = (ag*(RSI_LEN-1) + g)/RSI_LEN
            al = (al*(RSI_LEN-1) + l)/RSI_LEN
            r[i] = 100.0 if al == 0 else 100 - 100/(1 + ag/al)
    return r


def main():
    bad = []
    print('QQQ 주봉 시작일 의존성 검사')
    bw, bc = weekly(BASE)
    brsi = dict(zip(bw, rsi_of(bc)))
    bclose = dict(zip(bw, bc))
    print(f'  기준 start={BASE}  주봉 {len(bw)}개  {bw[0]} ~ {bw[-1]}')

    for s in ALTS:
        wk, cl = weekly(s)
        rsi = dict(zip(wk, rsi_of(cl)))
        com = [d for d in wk if d in brsi]

        # 1) 라벨·종가는 시작일과 무관해야 한다
        missing = [d for d in wk if d not in bclose]
        dclose = max((abs(bclose[d] - c) for d, c in zip(wk, cl) if d in bclose),
                     default=0.0)
        if missing:
            bad.append(f'{s}: 기준에 없는 주 라벨 {len(missing)}개 (예 {missing[:3]})')
        if dclose > TOL_CLOSE:
            bad.append(f'{s}: 주간 종가 최대차 {dclose:.6f} > {TOL_CLOSE}')

        # 2) 시드가 감쇠한 뒤에는 RSI 도 같아야 한다
        y, m, d = map(int, s.split('-'))
        cut = date(y + WARMUP_Y, m, d)
        warm = [x for x in com if x >= cut and rsi[x] is not None and brsi[x] is not None]
        dr = max((abs(rsi[x] - brsi[x]) for x in warm), default=0.0)
        nmid = sum(1 for x in warm if (rsi[x] <= RSI_MID) != (brsi[x] <= RSI_MID))
        n45 = sum(1 for x in warm if (rsi[x] <= BOS_RSI) != (brsi[x] <= BOS_RSI))
        print(f'  start={s}  주봉 {len(wk)}개  라벨차 {len(missing)}  종가차 {dclose:.2e}  '
              f'| +{WARMUP_Y}년 이후 {len(warm)}개: RSI차 {dr:.2e} 레짐 {nmid} 게이트45 {n45}')
        if dr > TOL_RSI:
            bad.append(f'{s}: 워밍업 뒤 RSI 최대차 {dr:.2e} > {TOL_RSI}')
        if nmid or n45:
            bad.append(f'{s}: 워밍업 뒤 판정 불일치 레짐 {nmid}건 게이트45 {n45}건')

    # 3) 디스크의 CSV 가 기준값과 같은가
    rows = list(csv.DictReader(open(os.path.join(D_, 'qqq_regime.csv'))))
    nbad = 0
    for r in rows:
        if not r['RSI']:
            continue
        y, m, d = map(int, r['WeekEnd'].split('-'))
        we = date(y, m, d)
        if we not in brsi or brsi[we] is None:
            nbad += 1
        elif abs(float(r['RSI']) - brsi[we]) > TOL_RSI:
            nbad += 1
    print(f'  qqq_regime.csv {len(rows)}행 중 기준과 어긋난 행 {nbad}건')
    if nbad:
        bad.append(f'qqq_regime.csv 가 기준 시작일 재계산과 {nbad}행 어긋남 '
                   f'— regime_build.py 재실행 필요')

    if bad:
        print('\n종합: [실패]')
        for b in bad:
            print(f'  · {b}')
        sys.exit(1)
    print('\n종합: [통과] 주 경계·라벨은 시작일과 무관하고, 워밍업 뒤 RSI 도 일치한다')


if __name__ == '__main__':
    main()
