# -*- coding: utf-8 -*-
"""SOXL 일봉 수집 -> data/SOXL_OHLC.csv

이 CSV 가 전략 전체의 기준 거래일 캘린더다. fetch_soxs.py 와 regime_build.py 가
모두 이 파일을 읽어 정렬하므로 갱신 순서는 반드시

    fetch_soxl.py  ->  fetch_soxs.py  ->  regime_build.py  ->  build_page_data.py

무결성 검사를 통과하지 못하면 기존 파일을 건드리지 않고 종료한다.
"""
import os, sys
import pandas as pd
import yfinance as yf

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUT = os.path.join(D, 'SOXL_OHLC.csv')
START = '2010-01-01'
COLS = ['Open', 'High', 'Low', 'Close', 'Volume']


def fetch():
    df = yf.download('SOXL', start=START, auto_adjust=True, progress=False)
    if df is None or df.empty:
        sys.exit('다운로드 실패: 빈 데이터프레임')
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[COLS].dropna()
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df.index.name = 'Date'
    return df


def check(df, old):
    """치명적 이상이면 메시지 리스트를 돌려준다 (비어 있으면 통과)."""
    bad = []
    if df.index.duplicated().any():
        bad.append(f'중복 거래일 {int(df.index.duplicated().sum())}건')
    if (df.index.weekday >= 5).any():
        bad.append(f'주말 행 {int((df.index.weekday >= 5).sum())}건')
    if (df['High'] < df['Low']).any():
        bad.append('High < Low')
    if ((df['Open'] > df['High']) | (df['Open'] < df['Low'])).any():
        bad.append('Open 이 고저 범위 밖')
    if ((df['Close'] > df['High']) | (df['Close'] < df['Low'])).any():
        bad.append('Close 가 고저 범위 밖')
    if (df[['Open', 'High', 'Low', 'Close']] <= 0).any().any():
        bad.append('0 이하 가격')
    if not df.index.is_monotonic_increasing:
        bad.append('날짜 정렬 오류')

    # 미기록 분할 탐지 — SOXL 은 3배 ETF 라 하루 ±50% 는 정상 범위지만
    # 그보다 큰 점프는 분할 아티팩트일 가능성이 높다 (2020-03 최대 약 -47%).
    r = df['Close'].pct_change().dropna()
    ext = r[(r > 1.0) | (r < -0.6)]
    if len(ext):
        bad.append('분할 의심 급변 ' + ', '.join(
            f'{d.date()} {v:+.1%}' for d, v in ext.items()))

    if old is not None and len(old):
        # 과거 구간이 조용히 바뀌면(재조정·분할) 사람이 확인해야 한다
        common = old.index.intersection(df.index)
        if len(common):
            drift = (df.loc[common, 'Close'] / old.loc[common, 'Close'] - 1).abs()
            n = int((drift > 0.01).sum())
            if n:
                worst = drift.idxmax()
                bad.append(f'과거 종가가 바뀜 {n}일 (최대 {worst.date()} '
                           f'{drift.max():.1%}) — 분할/재조정 확인 필요')
        if df.index.max() < old.index.max():
            bad.append(f'새 데이터가 더 짧음 ({df.index.max().date()} < {old.index.max().date()})')
    return bad


def main():
    old = None
    if os.path.exists(OUT):
        old = pd.read_csv(OUT, parse_dates=['Date']).set_index('Date')

    df = fetch()
    print(f'SOXL {len(df):,}행  {df.index.min().date()} ~ {df.index.max().date()}')

    bad = check(df, old)
    if bad:
        print('\n무결성 검사 실패 — 기존 파일을 유지합니다:')
        for b in bad:
            print(f'  · {b}')
        sys.exit(1)

    out = df.copy()
    out['Volume'] = out['Volume'].round().astype('int64')
    out.to_csv(OUT, float_format='%.6f')

    if old is not None:
        added = [d.date() for d in df.index if d not in set(old.index)]
        print(f'  추가된 거래일 {len(added)}일' + (f'  {added[0]} ~ {added[-1]}' if added else ''))
    print(f'  -> {OUT}')
    print('  다음 순서: fetch_soxs.py -> regime_build.py -> build_page_data.py')


if __name__ == '__main__':
    main()
