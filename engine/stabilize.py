# -*- coding: utf-8 -*-
"""과거 데이터를 안정화한다 — fetch_* 다음, build_page_data 앞에서 돈다.

야후는 배당·분할 조정계수를 매번 미세하게 다시 계산해서 내려준다. 그래서 새 거래일이
하나도 없어도 과거 수천 행이 6번째 소수점에서 흔들린다. 실측한 폭은

    SOXL 종가  상대오차 최대 2.84e-06
    QQQ  RSI   절대오차 최대 0.0004  (레짐 라벨 뒤집힘 0건)

주문값에는 영향이 없지만, 그대로 두면 휴장일에도 매일 6,600줄짜리 커밋이 쌓여
진짜 변화(새 봉·실제 분할)가 묻힌다. 과거 MA200 이 매일 흔들리는 것도 좋지 않다.

그래서 **허용오차 안의 변화는 이전 값으로 되돌리고**, 그보다 큰 변화만 남긴다.
큰 변화는 실제 분할·재조정이므로 화면에 크게 찍어 사람이 보게 한다.
"""
import csv, io, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))

# 관측 드리프트보다 한참 크고, 실제 분할·재조정(≥1%)보다는 한참 작게 잡는다
PRICE_TOL = 1e-4      # 상대 (0.01%)
RSI_TOL   = 0.01      # 절대

TARGETS = [
    ('data/SOXL_OHLC.csv',  'price'),
    ('data/SOXS_OHLC.csv',  'price'),
    ('data/qqq_regime.csv', 'rsi'),
]


def head_version(rel):
    """git HEAD 의 파일 내용. 저장소가 아니거나 파일이 없으면 None."""
    try:
        out = subprocess.run(['git', 'show', f'HEAD:{rel}'], cwd=ROOT,
                             capture_output=True, timeout=30)
        if out.returncode != 0:
            return None
        return out.stdout.decode('utf-8')
    except Exception:
        return None


def rows(text):
    r = csv.reader(io.StringIO(text))
    head = next(r)
    return head, [x for x in r if x]


def same(old, new, kind):
    """허용오차 안이면 True. 값 하나라도 벗어나면 False."""
    if len(old) != len(new):
        return False
    for i, (a, b) in enumerate(zip(old, new)):
        if i == 0:
            if a != b:
                return False
            continue
        if a == b:
            continue
        try:
            fa, fb = float(a), float(b)
        except ValueError:
            return False          # 레짐 라벨 같은 문자열이 바뀐 것 — 실제 변화
        if kind == 'rsi':
            if abs(fa - fb) > RSI_TOL:
                return False
        else:
            denom = max(abs(fa), abs(fb), 1e-12)
            if abs(fa - fb) / denom > PRICE_TOL:
                return False
    return True


def stabilize(rel, kind):
    path = os.path.join(ROOT, rel)
    prev = head_version(rel)
    if prev is None:
        print(f'  {rel:24} 이전 버전 없음 — 그대로 둡니다')
        return 0
    # 줄바꿈은 파일마다 다르다 (regime CSV 는 CRLF, 나머지는 LF).
    # 비교는 내용으로만 하고, 쓸 때는 이전 파일의 줄바꿈을 그대로 따른다.
    eol = '\r\n' if '\r\n' in prev else '\n'
    cur = io.open(path, encoding='utf-8', newline='').read()
    if cur.replace('\r\n', '\n') == prev.replace('\r\n', '\n'):
        print(f'  {rel:24} 변화 없음')
        return 0

    ph, prows = rows(prev)
    ch, crows = rows(cur)
    if ph != ch:
        print(f'  {rel:24} 헤더가 바뀜 — 그대로 둡니다')
        return 0

    pmap = {r[0]: r for r in prows}
    kept = restored = added = changed = 0
    material = []
    out = []
    for r in crows:
        p = pmap.get(r[0])
        if p is None:
            out.append(r); added += 1
        elif p == r:
            out.append(p); kept += 1
        elif same(p, r, kind):
            out.append(p); restored += 1          # 노이즈 — 이전 값 유지
        else:
            out.append(r); changed += 1           # 실제 변화 — 새 값 채택
            if len(material) < 5:
                material.append((r[0], p, r))

    dropped = [d for d in pmap if d not in {r[0] for r in crows}]

    if restored and not (added or changed or dropped):
        note = '노이즈만 — 파일을 되돌립니다'
    else:
        note = f'신규 {added}  실변경 {changed}  삭제 {len(dropped)}'
    print(f'  {rel:24} 유지 {kept}  노이즈복원 {restored}  {note}')

    for d, p, r in material:
        print(f'      [실변경] {d}\n        이전 {p}\n        이후 {r}')
    if dropped:
        print(f'      [경고] 사라진 날짜 {len(dropped)}건: {sorted(dropped)[:5]}')

    material_n = changed + added + len(dropped)
    if material_n == 0:
        # 실질 변화가 없으면 이전 파일을 바이트 그대로 되돌린다 — diff 가 0 이 된다
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(prev)
    else:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, lineterminator=eol)
            w.writerow(ch)
            w.writerows(out)
    return material_n


def main():
    print('과거 데이터 안정화 (허용오차 안의 흔들림은 이전 값으로 되돌림)')
    print(f'  가격 상대 {PRICE_TOL:g} · RSI 절대 {RSI_TOL:g}')
    total = 0
    for rel, kind in TARGETS:
        total += stabilize(rel, kind)
    print(f'\n실질 변화 {total}건' + ('' if total else ' — 커밋할 내용이 없습니다'))


if __name__ == '__main__':
    main()
