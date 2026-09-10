# -*- coding: utf-8 -*-
"""SOXS 조정 OHLC 수집 -> data/SOXS_OHLC.csv

Yahoo 의 SOXS 시계열에는 미기록 분할이 남아 있다(2026-05-26 의 15:1 액면분할).
SOXL 과 SOXS 는 같은 지수의 ±3배이므로 일간수익률 합 rL + rS 는 0 근처여야 한다.
이 합이 비정상적으로 큰 날을 분할 잔재로 보고 이전 구간 전체를 배율로 되돌린다.
정상일의 |rL + rS| 는 중앙값 0.13%, 95분위 0.56%, 최대 18%(2020-03 극단 변동)이므로
임계값 50% 는 실제 시장 변동과 분할 잔재를 안전하게 가른다.
"""
import os, csv, sys
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ydl

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
THRESH = 0.50


def fetch(ticker, start='2010-01-01'):
    df = ydl.download(ticker, start=start, auto_adjust=True)
    if df is None or df.empty:
        sys.exit(f'{ticker} 다운로드 실패: 빈 데이터프레임')
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df[['Open', 'High', 'Low', 'Close', 'Volume']].dropna()


def repair(sox, soxs):
    """미기록 분할 탐지 -> 그 이전 구간 전체를 배율 f 로 나눈다."""
    idx = soxs.index.intersection(sox.index)
    fixes = []
    while True:
        cl_l, cl_s = sox.loc[idx, 'Close'], soxs.loc[idx, 'Close']
        rl, rs = cl_l.pct_change(), cl_s.pct_change()
        bad = (rl + rs).abs() > THRESH
        if not bad.any():
            break
        d = bad[bad].index[0]
        i = idx.get_loc(d)
        want = cl_s.iloc[i] / (1 - rl.iloc[i])        # rS ≈ −rL 이었어야 할 전일 종가
        f = round(cl_s.iloc[i - 1] / want)
        if f in (0, 1):
            sys.exit(f'{d.date()}: 배율 산출 실패 (f={cl_s.iloc[i-1]/want:.3f})')
        soxs.loc[soxs.index < d, ['Open', 'High', 'Low', 'Close']] /= f
        fixes.append((d.date(), f, cl_s.iloc[i - 1] / want))
    return fixes


def main():
    sox, soxs = fetch('SOXL'), fetch('SOXS')
    print(f'SOXL {len(sox)}행  {sox.index.min().date()} ~ {sox.index.max().date()}')
    print(f'SOXS {len(soxs)}행  {soxs.index.min().date()} ~ {soxs.index.max().date()}')

    fixes = repair(sox, soxs)
    print('\n--- 미기록 분할 보정 ---')
    for d, f, raw in fixes:
        print(f'  {d}  {f}:1 액면분할 -> 이전 구간 ÷{f}  (산출값 {raw:.3f})')
    if not fixes:
        print('  없음')

    # data/SOXL_OHLC.csv 의 거래일에 맞춰 정렬·절단 (전략은 그 캘린더로 돈다)
    ref = pd.read_csv(os.path.join(D, 'SOXL_OHLC.csv'), parse_dates=['Date'])
    keep = set(ref['Date'])
    newer = [d.date() for d in sox.index if d not in keep and d > ref['Date'].max()]
    if newer:
        print(f'\n※ Yahoo 에 SOXL {len(newer)}거래일이 더 있습니다 ({newer[0]} ~ {newer[-1]}).')
        print('  SOXL_OHLC.csv 를 갱신하지 않았으므로 SOXS 도 같은 날짜에서 자릅니다.')
    dates = [d for d in sox.index if d in keep and d in soxs.index]
    miss = [d.date() for d in sox.index if d in keep and d not in soxs.index]
    out = soxs.loc[dates]

    rl = sox.loc[dates, 'Close'].pct_change()
    rs = out['Close'].pct_change()
    resid = (rl + rs).abs().dropna()
    viol = ((out['High'] < out[['Open', 'Close']].max(axis=1) * (1 - 1e-9)) |
            (out['Low'] > out[['Open', 'Close']].min(axis=1) * (1 + 1e-9))).sum()

    print('\n--- 무결성 ---')
    print(f'  행수 {len(out):,}  (SOXL 대비 결측 {len(miss)}일)')
    print(f'  중복일 {out.index.duplicated().sum()}  주말행 {(out.index.weekday >= 5).sum()}  '
          f'0 이하 가격 {(out[["Open","High","Low","Close"]] <= 0).sum().sum()}')
    print(f'  OHLC 위반 {viol}')
    print(f'  |rL+rS| 중앙값 {resid.median():.4%}  95분위 {resid.quantile(.95):.4%}  최대 {resid.max():.4%}')
    print(f'  잔여 이상치(>{THRESH:.0%}) {(resid > THRESH).sum()}건')
    top = resid.nlargest(3)
    for d, v in top.items():
        print(f'    {d.date()}  SOXL {rl[d]:+.2%}  SOXS {rs[d]:+.2%}  |합| {v:.2%}')

    out.index.name = 'Date'
    p = os.path.join(D, 'SOXS_OHLC.csv')
    out.to_csv(p, float_format='%.6f')
    print(f'\n저장: {p}')


if __name__ == '__main__':
    main()
