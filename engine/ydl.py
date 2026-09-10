# -*- coding: utf-8 -*-
"""yfinance 다운로드 재시도 래퍼.

Yahoo 는 GitHub Actions 러너의 IP 를 종종 레이트리밋한다. 그때 yf.download 는
예외 없이 빈 DataFrame 을 즉시 돌려주므로, 호출부는 "데이터가 없다"와
"차단당했다"를 구분하지 못하고 그대로 죽는다. 실제로 2026-09-09 야간 실행이
1초 만에 6단계에서 실패했다(run 34417028573).

여기서 지수 백오프로 다시 시도한다. 야간 갱신은 다음 개장까지 16시간 여유가
있으므로 최대 ~8분을 기다려도 안전하다. 끝내 못 받으면 빈 결과를 그대로
돌려주고, 판단(sys.exit 등)은 호출부의 기존 무결성 검사에 맡긴다.
"""
import random
import sys
import time

import yfinance as yf

# 대기 시간(초). 앞은 짧게 — 순간적인 레이트리밋이 대부분이다.
DELAYS = (10, 30, 60, 120, 240)


def download(ticker, **kw):
    """yf.download 와 같은 인자. 비어 있지 않은 DataFrame 을 받을 때까지 재시도한다."""
    kw.setdefault('progress', False)
    df, last = None, None
    for i, delay in enumerate((None,) + DELAYS):
        if delay is not None:
            # 지터를 섞어 여러 잡이 동시에 재시도하는 것을 피한다.
            wait = delay * random.uniform(0.8, 1.2)
            print(f'  {ticker} 재시도 {i}/{len(DELAYS)} — {wait:.0f}초 대기', flush=True)
            time.sleep(wait)
        try:
            df = yf.download(ticker, **kw)
        except Exception as e:                      # 네트워크·JSON 파싱 등
            last = f'{type(e).__name__}: {e}'
            print(f'  {ticker} 다운로드 예외 — {last}', file=sys.stderr, flush=True)
            continue
        if df is not None and not df.empty and not df.dropna(how='all').empty:
            if i:
                print(f'  {ticker} {i}회 재시도 후 성공', flush=True)
            return df
        last = '빈 DataFrame (Yahoo 레이트리밋 가능성)'
        print(f'  {ticker} — {last}', file=sys.stderr, flush=True)
    print(f'  {ticker} {len(DELAYS)}회 재시도 모두 실패 — 마지막 원인: {last}',
          file=sys.stderr, flush=True)
    return df
