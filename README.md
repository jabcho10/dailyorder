# dailyorder — SOXL·SOXS 일일 주문 페이지

SOXL·SOXS 변동성 돌파 + SOXL 레짐 그리드 전략의 **다음 거래일 주문표**를 뽑는 정적 페이지와,
그 데이터를 매일 자동으로 갱신하는 파이프라인. 같은 규칙으로 **기간을 골라 돌려보는
백테스트 페이지**(`backtest.html`)가 함께 들어 있다.

> 전략 규칙 문서는 이 저장소에 포함하지 않는다 (`.gitignore`). 규칙의 실제 정의는
> `soxl-daily-orders-source/dist/spec.js` 와 `engine/strategy.py` 두 곳에 있고,
> 아래 검증이 그 둘이 같은 주문을 내는지 대조한다.

## 구조

```
engine/
  fetch_soxl.py        SOXL 일봉 -> data/SOXL_OHLC.csv   (기준 거래일 캘린더)
  fetch_soxs.py        SOXS 일봉 + 미기록 분할 자동 보정
  regime_build.py      QQQ 주봉 RSI(14, Wilder) -> data/qqq_regime.csv
  stabilize.py         허용오차 안의 과거 데이터 흔들림을 이전 값으로 되돌린다
  build_page_data.py   위 CSV -> dist/data.js (오프라인 폴백) + dist/data.json (런타임 fetch)
  strategy.py          백테스트 엔진 + next_orders() (주문 산출 기준 구현)
  run.py               백테스트 실행

soxl-daily-orders-source/dist/
  spec.js              주문 계산 엔진. DOM 접근 없음. 규칙은 전부 여기에만 있다.
  app.js               UI 전용. 규칙 없음.
  data.js / data.json  자동 생성물 (build_page_data.py)
  index.html, styles.css

  backtest.js          백테스트 엔진. DOM 접근 없음. 파라미터는 spec.js 에서 읽는다.
  backtest-app.js      백테스트 UI 전용. 규칙 없음.
  backtest.html, backtest.css

verify/
  page_parity.py/.js   spec.js  vs  strategy.py 주문 대조
  page_ladder.js       그리드 계획표가 사다리 규칙과 맞는지
  page_backtest.py/.js backtest.js vs strategy.py 백테스트 대조 (구간·설정 7종)
  page_smoke.js        페이지가 실제로 렌더되는지 (id 불일치 = 백지 페이지 방지)
  page_backtest_smoke.js  백테스트 페이지 렌더 + 화면 수치가 엔진 값과 같은지
  page_backtest_interact.js  프리셋·기간·배분·툴팁을 눌러본 뒤의 수치까지 대조
  independent.py       백테스트 엔진 독립 재구현 대조
  audit.py             파라미터 고원·워크포워드·미래참조 감사
  period1_trap.py      QQQ 주봉 RSI 시드 함정 검사 (네트워크 필요)
```

## 자동 갱신

`.github/workflows/page-data.yml` 이 평일 21:30 UTC(한국 06:30, 미국장 마감 +1.5h)에 돈다.

```
fetch_soxl -> regime_build -> fetch_soxs -> stabilize -> build_page_data -> 검증 4종 -> 커밋
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
python engine/stabilize.py         # 야후 조정계수 노이즈 제거 (git 저장소에서만 동작)
python engine/build_page_data.py

python verify/page_parity.py && node verify/page_parity.js
node verify/page_ladder.js
python verify/page_backtest.py && node verify/page_backtest.js
node verify/page_smoke.js
node verify/page_backtest_smoke.js
node verify/page_backtest_interact.js
python verify/independent.py
```

`dist/index.html` 을 브라우저에서 바로 열어도 동작한다.

## 백테스트 페이지

`dist/backtest.html` — 시작일·종료일(또는 프리셋)과 초기 자본·배분·SOXS 사용 여부를 골라
그 구간만 다시 돌린다. 자산곡선·낙폭·연도별 수익률·체결 통계·구성별 비교표가 나온다.

- **지표는 CSV 전체로 계산하고 선택 구간에서만 매매한다.** 2020년부터로 잡아도
  그 첫날의 이동평균은 2019년 데이터로 이미 서 있다. 구간을 줄여도 겹치는 날의 자산은
  똑같아야 하며, `verify/page_backtest.js` 가 그것까지 검사한다.
- 원본 CSV 는 `data/` 를 `raw.githubusercontent.com` 에서 그대로 받는다 (`csv-base-url` 메타).
  주문 페이지와 달리 260봉짜리 내장 데이터로는 부족해 전체 이력이 필요하기 때문이다.
  받지 못하면 CSV 3개를 직접 선택하는 입력이 뜬다.
- 수량은 소수 주식이다 (`engine/strategy.py` 와 같은 이유 — SOXS 과거 조정가 문제).
  실주문 수량 내림은 주문 페이지에서만 한다. 계좌가 작을수록 실제 결과는 더 나쁘다.

## 주의

- `regime_build.py` 의 `start='2005-01-01'` 을 바꾸지 말 것. 주봉 RSI 는 시드 구간에 따라
  값이 달라지고(최대 17포인트), 레짐(50)과 SOXS 게이트(45) 판정이 함께 흔들린다.
  `verify/period1_trap.py` 가 이걸 검사한다.
- SOXS 조정가에는 반복된 역분할이 반영돼 있다. 과거 조정주가에 현재 기준 정수수량을
  직접 적용하면 안 된다. 최근 구간만 현재 호가와 일치한다.
- **돌파 필터선(`MA_LEN`)과 정배열 장기선(`MA_SLOW`)은 다른 값이다.** 두 값이 200 으로
  같던 시절 `spec.js` 의 돌파 게이트가 `MA_SLOW` 로 계산한 `ma200` 을 쓰고 있었고,
  `MA_LEN` 을 50 으로 내리면서 드러났다. 게이트는 반드시 `P.MA_LEN` 으로 계산한
  `maBo` 를 쓸 것. 같은 이유로 `page_parity` 는 두 엔진에 **같은 RSI** 를 먹여야 한다 —
  `spec.js` 는 레짐을 RSI 에서 파생시키므로 레짐만 맞추면 SOXS 게이트(45)가 엇갈린다.
- 규칙을 바꿀 때는 `spec.js` 와 `strategy.py` 를 함께 고치고 `page_parity` 를 돌릴 것.
  한쪽만 고치면 검증에서 잡힌다. 백테스트 페이지는 `backtest.js` 가 `spec.js` 의
  파라미터를 그대로 읽으므로 파라미터는 한 곳만 고치면 되지만, 하루의 순서를 바꿨다면
  `backtest.js` 도 함께 고치고 `page_backtest` 를 돌려야 한다.
- 이 페이지는 주문 참고용이다. 실제 주문 전 종목·가격·수량을 직접 확인할 것.
