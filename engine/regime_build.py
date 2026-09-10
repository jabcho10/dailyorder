# -*- coding: utf-8 -*-
"""QQQ weekly RSI(14, Wilder) -> regime flag, aligned to SOXL trading days.
   NO LOOK-AHEAD: a weekly bar closing on date W is only usable from the next
   SOXL trading day > W."""
import csv, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ydl
import pandas as pd
D_=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
from datetime import date, timedelta

RSI_LEN, RSI_MID = 14, 50

# --- QQQ weekly (fetch daily then resample so week-end dates are exact) ---
# interval='1wk' 로 받으면 인덱스가 '그 주의 시작일'로 붙는다. 그러면 아래
# wk[k] < d 판정이 아직 끝나지도 않은 이번 주 봉을 그 주 화요일부터 쓰게 되어
# 룩어헤드가 된다(예: 2026-08-24 행이 8/28 종가로 만든 RSI 를 썼다).
# 게다가 그 주가 진행 중이면 봉 자체가 반쪽이라 값이 매일 흔들린다.
# 일봉을 받아 직접 주 단위로 접고, 그 주의 '마지막 실제 거래일'을 라벨로 쓴다.
# 그래야 위 판정이 파일 첫머리에 적힌 NO LOOK-AHEAD 규칙 그대로 동작한다.
raw = ydl.download('QQQ', start='2005-01-01', auto_adjust=True)
if raw is None or raw.empty:
    sys.exit('QQQ 다운로드 실패: 빈 데이터프레임')
if hasattr(raw.columns, 'levels'): raw.columns = raw.columns.droplevel(1)
raw = raw[['Close']].dropna()
raw.index = pd.to_datetime(raw.index).tz_localize(None).normalize()

# 마지막 주는 금요일이 지나야 완결로 본다. 금요일이 휴장이면 다음 주 월요일에
# 들어온다 — 하루 늦을 뿐, 미래를 당겨쓰지는 않는다.
last_day = raw.index[-1].date()
cl, wk = [], []
for period, grp in raw.groupby(raw.index.to_period('W-SUN'), sort=True):
    if last_day < period.start_time.date() + timedelta(days=4):
        break                                  # 진행 중인 주 — 버린다
    wk.append(grp.index[-1].date())            # 그 주의 마지막 거래일
    cl.append(float(grp['Close'].iloc[-1]))
print(f'QQQ weekly bars: {len(cl)}  {wk[0]} ~ {wk[-1]}')

# --- Wilder RSI ---
rsi = [None]*len(cl)
gains = losses = 0.0
for i in range(1, len(cl)):
    ch = cl[i]-cl[i-1]; g, l = max(ch,0.0), max(-ch,0.0)
    if i <= RSI_LEN:
        gains += g; losses += l
        if i == RSI_LEN:
            ag, al = gains/RSI_LEN, losses/RSI_LEN
            rsi[i] = 100.0 if al==0 else 100-100/(1+ag/al)
    else:
        ag = (ag*(RSI_LEN-1)+g)/RSI_LEN
        al = (al*(RSI_LEN-1)+l)/RSI_LEN
        rsi[i] = 100.0 if al==0 else 100-100/(1+ag/al)

# --- SOXL trading days ---
sox = []
for r in csv.DictReader(open(os.path.join(D_,'SOXL_OHLC.csv'))):
    y,m,d = map(int, r['Date'].split('-')); sox.append(date(y,m,d))

# --- map each SOXL day to the most recent weekly bar that had already CLOSED ---
out = []
j = 0
for d in sox:
    while j+1 < len(wk) and wk[j+1] < d:   # strictly before -> bar is closed
        j += 1
    k = j if wk[j] < d else j-1
    v = rsi[k] if k >= 0 else None
    out.append((d, wk[k] if k>=0 else None, v))

with open(os.path.join(D_,'qqq_regime.csv'),'w',newline='') as f:
    w = csv.writer(f); w.writerow(['Date','WeekEnd','RSI','Regime'])
    for d, we, v in out:
        w.writerow([d, we, f'{v:.4f}' if v is not None else '',
                    '' if v is None else ('BOTTOM' if v <= RSI_MID else 'TOP')])

valid = [(d,v) for d,we,v in out if v is not None]
nb = sum(1 for _,v in valid if v <= RSI_MID)
print(f'SOXL days mapped: {len(out)}  (RSI available on {len(valid)})')
print(f'BOTTOM (RSI<=50): {nb} days ({nb/len(valid)*100:.1f}%)   '
      f'TOP (RSI>50): {len(valid)-nb} days ({(len(valid)-nb)/len(valid)*100:.1f}%)')
print(f'RSI range {min(v for _,v in valid):.1f} ~ {max(v for _,v in valid):.1f}')
print('\nsample (regime flips):')
prev=None
for d,we,v in out:
    if v is None: continue
    r = 'BOTTOM' if v<=RSI_MID else 'TOP'
    if r!=prev: print(f'  {d}  weekbar {we}  RSI {v:5.1f}  -> {r}')
    prev=r
