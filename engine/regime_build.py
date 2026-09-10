# -*- coding: utf-8 -*-
"""QQQ weekly RSI(14, Wilder) -> regime flag, aligned to SOXL trading days.
   NO LOOK-AHEAD: a weekly bar closing on date W is only usable from the next
   SOXL trading day > W."""
import csv, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ydl
D_=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
from datetime import date

RSI_LEN, RSI_MID = 14, 50

# --- QQQ weekly (fetch daily then resample so week-end dates are exact) ---
df = ydl.download('QQQ', start='2005-01-01', end='2026-09-01',
                  interval='1wk', auto_adjust=True)
if df is None or df.empty:
    sys.exit('QQQ 다운로드 실패: 빈 데이터프레임')
if hasattr(df.columns, 'levels'): df.columns = df.columns.droplevel(1)
df = df.dropna()
cl = df['Close'].tolist()
wk = [d.date() if hasattr(d, 'date') else d for d in df.index]
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
