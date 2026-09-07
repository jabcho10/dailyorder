# dailyorder — SOXL·SOXS 일일 주문 페이지

SOXL·SOXS 변동성 돌파 + SOXL 레짐 그리드 전략의 **다음 거래일 주문표**를 뽑는 정적 페이지와,
그 데이터를 매일 자동으로 갱신하는 파이프라인.

> 전략 규칙 문서는 이 저장소에 포함하지 않는다 (`.gitignore`). 규칙의 실제 정의는
> `soxl-daily-orders-source/dist/spec.js` 와 `engine/strategy.py` 두 곳에 있고,
> 아래 검증이 그 둘이 같은 주문을 내는지 대조한다.

## 구조

```
engine/
  fetch_soxl.py        SOXL 일봉 -> data/SOXL_OHLC.csv   (기준 거래일 캘린더)
  fetch_soxs.py        SOXS 일봉 + 미기록 분할 자동 보정
  regime_build.py      QQQ 주봉 RSI(14, Wilder) -> data/qqq_regime.csv
  build_page_data.py   위 CSV -> dist/data.js (오프라인 폴백) + dist/data.json (런타임 fetch)
  strategy.py          백테스트 엔진 + next_orders() (주문 산출 기준 구현)
  run.py               백테스트 실행

soxl-daily-orders-source/dist/
  spec.js              주문 계산 엔진. DOM 접근 없음. 규칙은 전부 여기에만 있다.
  app.js               UI 전용. 규칙 없음.
  data.js / data.json  자동 생성물 (build_page_data.py)
  index.html, styles.css

verify/
  page_parity.py/.js   spec.js  vs  strategy.py 주문 대조
  page_ladder.js       그리드 계획표가 사다리 규칙과 맞는지
  page_smoke.js        페이지가 실제로 렌더되는지 (id 불일치 = 백지 페이지 방지)
  independent.py       백테스트 엔진 독립 재구현 대조
  audit.py             파라미터 고원·워크포워드·미래참조 감사
  period1_trap.py      QQQ 주봉 RSI 시드 함정 검사 (네트워크 필요)
```

## 자동 갱신

`.github/workflows/page-data.yml` 이 평일 21:30 UTC(한국 06:30, 미국장 마감 +1.5h)에 돈다.

```
fetch_soxl -> regime_build -> fetch_soxs -> build_page_data -> 검증 4종 -> 커밋
```

**검증을 통과해야만 커밋한다.** 시세 제공처가 이상한 값을 주거나 SOXS 분할 보정이
실패하면 커밋 단계에 도달하지 못하므로, 틀린 데이터가 페이지로 나가지 않는다.

배포된 페이지는 로드할 때 `raw.githubusercontent.com` 에서 `dist/data.json` 을 직접 받는다.
따라서 **데이터만 갱신되면 페이지를 다시 배포할 필요가 없다.**
(raw 는 `Access-Control-Allow-Origin: *` 를 준다 — 저장소가 공개여야 하는 이유다.)

받아오지 못하면 내장 `data.js` 로 폴백하고, 데이터가 평일 기준 2일 이상 묵으면
페이지 상단에 경고가 뜬다. 3일 이상이면 빨간 경고로 바뀐다.

## 수동 실행

```bash
python engine/fetch_soxl.py        # 순서 중요: SOXL 이 기준 캘린더
python engine/regime_build.py
python engine/fetch_soxs.py
python engine/build_page_data.py

python verify/page_parity.py && node verify/page_parity.js
node verify/page_ladder.js
node verify/page_smoke.js
python verify/independent.py
```

`dist/index.html` 을 브라우저에서 바로 열어도 동작한다.

## 주의

- `regime_build.py` 의 `start='2005-01-01'` 을 바꾸지 말 것. 주봉 RSI 는 시드 구간에 따라
  값이 달라지고(최대 17포인트), 레짐(50)과 SOXS 게이트(45) 판정이 함께 흔들린다.
  `verify/period1_trap.py` 가 이걸 검사한다.
- SOXS 조정가에는 반복된 역분할이 반영돼 있다. 과거 조정주가에 현재 기준 정수수량을
  직접 적용하면 안 된다. 최근 구간만 현재 호가와 일치한다.
- 규칙을 바꿀 때는 `spec.js` 와 `strategy.py` 를 함께 고치고 `page_parity` 를 돌릴 것.
  한쪽만 고치면 검증에서 잡힌다.
- 이 페이지는 주문 참고용이다. 실제 주문 전 종목·가격·수량을 직접 확인할 것.
