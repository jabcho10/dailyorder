/* 백테스트 페이지 UI.
 * 계산은 전부 backtest.js 의 BT 가 하고, 파라미터는 spec.js 의 SPEC.P 에 있다.
 * 이 파일에는 규칙이 없다 — 규칙을 바꿔야 하면 spec.js 를 고칠 것.
 */
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var P = SPEC.P;
  var LS = 'soxl-backtest-v1';

  var BARS = null;          // BT.prepare() 결과
  var CSV = { soxl: null, soxs: null, rsi: null };

  var input = {
    from: '', to: '', init: 100000, alloc: 'dyn', bos: true,
    cmpBH: true, cmpAlt: false, scale: 'log'
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || 'null');
    if (saved) Object.keys(input).forEach(function (k) {
      if (saved[k] !== undefined) input[k] = saved[k];
    });
  } catch (e) { /* 시크릿 모드 */ }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(input)); } catch (e) { /* 무시 */ }
  }

  // ── 표시 헬퍼 ───────────────────────────────────────────
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    return Number.isFinite(n) ? '$' + n.toLocaleString('en-US',
      { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—';
  };
  var money2 = function (n) {
    return Number.isFinite(n) ? '$' + n.toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  };
  function compact(n) {
    if (!Number.isFinite(n)) return '—';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return s + '$' + a.toFixed(0);
  }
  var pct = function (n, d) {
    return Number.isFinite(n) ? (n * 100).toFixed(d == null ? 2 : d) + '%' : '—';
  };
  var signPct = function (n, d) {
    return Number.isFinite(n) ? (n >= 0 ? '+' : '') + (n * 100).toFixed(d == null ? 2 : d) + '%' : '—';
  };
  var num = function (n, d) { return Number.isFinite(n) ? n.toFixed(d == null ? 2 : d) : '—'; };
  var css = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  // ── 데이터 적재 ─────────────────────────────────────────
  function baseUrl() {
    var m = document.querySelector('meta[name="csv-base-url"]');
    var u = m && m.getAttribute('content');
    if (!u || u.indexOf('OWNER/REPO') >= 0) return null;
    return u.replace(/\/?$/, '/');
  }

  function build() {
    if (!CSV.soxl || !CSV.rsi) return false;
    BARS = BT.prepare({ soxl: CSV.soxl, soxs: CSV.soxs || [], rsi: CSV.rsi });
    if (BARS.length < 3) return false;
    $('dataRange').textContent = BARS[0].d + ' ~ ' + BARS[BARS.length - 1].d;
    var f = $('fromDate'), t = $('toDate');
    f.min = t.min = BARS[0].d;
    f.max = t.max = BARS[BARS.length - 1].d;
    if (!input.from || input.from < BARS[0].d) input.from = BARS[0].d;
    if (!input.to || input.to > BARS[BARS.length - 1].d) input.to = BARS[BARS.length - 1].d;
    syncInputs();
    render();
    return true;
  }

  function state(text, cls) {
    $('dataState').textContent = text;
    $('dataState').className = cls || '';
  }

  function loadRemote(manual) {
    var base = baseUrl();
    if (!base) { needFiles('원격 CSV 위치가 설정돼 있지 않습니다.'); return; }
    state('CSV 를 받는 중…');
    var files = ['SOXL_OHLC.csv', 'SOXS_OHLC.csv', 'qqq_regime.csv'];
    // 전체 이력이라 3개 합쳐 수백 KB 다. 주문 페이지와 달리 분 단위 신선도가
    // 필요 없으므로 브라우저 캐시를 그대로 쓰고, "다시 받기" 를 눌렀을 때만 강제로 새로 받는다.
    Promise.all(files.map(function (f) {
      return fetch(base + f, { cache: manual ? 'reload' : 'default' }).then(function (r) {
        if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
        return r.text();
      });
    })).then(function (txt) {
      CSV.soxl = BT.parseBars(txt[0]);
      CSV.soxs = BT.parseBars(txt[1]);
      CSV.rsi = BT.parseRsi(txt[2]);
      if (!build()) throw new Error('데이터가 너무 짧습니다');
      $('loadWarn').innerHTML = '';
      state('원격 CSV · SOXL ' + CSV.soxl.length + '봉', 'live');
    }).catch(function (e) {
      if (manual) console.warn('csv fetch:', e);
      needFiles('CSV 를 받지 못했습니다 (' + e.message + ').');
    });
  }

  function needFiles(msg) {
    state('데이터 없음', 'error');
    $('loadWarn').innerHTML = '<div class="loadbar bad"><span>' + esc(msg)
      + ' 오프라인이거나 저장소가 비공개면 <b>data/</b> 폴더의 CSV 3개를 직접 선택하세요.</span>'
      + '<input type="file" accept=".csv" id="csvPick" multiple /></div>';
    $('csvPick').addEventListener('change', onPick);
  }

  function onPick(e) {
    var files = Array.from(e.target.files || []);
    if (!files.length) return;
    var left = files.length, msgs = [];
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var txt = rd.result;
          if (/rsi/i.test(txt.split(/\r?\n/)[0])) {
            CSV.rsi = BT.parseRsi(txt); msgs.push('레짐 ' + Object.keys(CSV.rsi).length + '행');
          } else if (/soxs/i.test(f.name)) {
            CSV.soxs = BT.parseBars(txt); msgs.push('SOXS ' + CSV.soxs.length + '봉');
          } else {
            CSV.soxl = BT.parseBars(txt); msgs.push('SOXL ' + CSV.soxl.length + '봉');
          }
        } catch (err) { msgs.push(f.name + ': ' + err.message); }
        if (--left === 0) {
          if (build()) {
            $('loadWarn').innerHTML = '';
            state('내 파일 · ' + msgs.join(' · '), 'live');
          } else {
            $('loadWarn').querySelector('span').textContent =
              'SOXL·SOXS·qqq_regime CSV 세 개가 모두 필요합니다. (' + msgs.join(' · ') + ')';
          }
        }
      };
      rd.readAsText(f);
    });
  }

  // ── 구간 계산 ───────────────────────────────────────────
  function shiftYears(date, n) {
    var d = new Date(date + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  }

  function presetRange(key) {
    var first = BARS[0].d, last = BARS[BARS.length - 1].d;
    if (key === 'all') return [first, last];
    if (key === '2016') return ['2016-01-01', last];
    if (key === 'ytd') return [last.slice(0, 4) + '-01-01', last];
    var n = { y10: 10, y5: 5, y3: 3, y1: 1 }[key];
    return [shiftYears(last, n), last];
  }

  function activePreset() {
    var keys = ['all', '2016', 'y10', 'y5', 'y3', 'y1', 'ytd'];
    for (var i = 0; i < keys.length; i++) {
      var r = presetRange(keys[i]);
      if (r[0] === input.from && r[1] === input.to) return keys[i];
      // 프리셋이 데이터 시작보다 이르면 첫날로 잘린다 — 같은 구간으로 본다
      if (r[0] < BARS[0].d && input.from === BARS[0].d && r[1] === input.to) return keys[i];
    }
    return null;
  }

  var ALLOC = {
    dyn: { label: '동적 30:70 / 20:80', wBo: null },
    w20: { label: '고정 20:80', wBo: P.W_BASE },
    w30: { label: '고정 30:70', wBo: P.W_STRONG },
    grid: { label: '그리드 단독', wBo: 0 },
    bo: { label: '돌파 단독', wBo: 1 }
  };

  // ── 렌더 ────────────────────────────────────────────────
  function render() {
    if (!BARS) return;
    var i0 = BT.indexFrom(BARS, input.from);
    var i1 = BT.indexTo(BARS, input.to);
    if (i0 < 1) i0 = 1;
    if (i1 < 0) i1 = BARS.length - 1;

    $('presets').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.preset === activePreset());
    });

    if (i1 - i0 < 2) {
      $('rangeTag').textContent = '구간이 너무 짧습니다';
      $('perfTitle').textContent = '—';
      $('statRow').innerHTML = '<div class="stat"><span>거래일</span><b>0</b>'
        + '<small>시작일과 종료일 사이에 거래일이 거의 없습니다</small></div>';
      ['eqChart', 'ddChart'].forEach(function (id) { $(id).innerHTML = ''; });
      ['yearRows', 'tradeRows', 'cmpRows'].forEach(function (id) {
        $(id).innerHTML = '<tr><td class="empty" colspan="7">구간을 넓히세요</td></tr>';
      });
      return;
    }

    var init = Math.max(1, Number(input.init) || 100000);
    var conf = ALLOC[input.alloc] || ALLOC.dyn;
    var opt = { i0: i0, i1: i1, wBo: conf.wBo, bosOn: !!input.bos, init: init };
    var r = BT.run(BARS, opt);
    var st = BT.stats(r.eq, init);

    $('rangeTag').textContent = st.from + ' ~ ' + st.to + ' · ' + st.n.toLocaleString('en-US') + '거래일';
    $('perfTitle').textContent = conf.label + (input.bos ? '' : ' · SOXS 없이');
    $('perfTag').textContent = num(st.yrs, 1) + '년';

    // 워밍업 — 돌파 필터선(MA_LEN)이 서기 전 구간에는 돌파 주문이 나가지 않는다
    var warm = P.MA_LEN - i0;
    $('warmNote').innerHTML = warm > 0
      ? '⚠ 시작일이 데이터 첫 ' + P.MA_LEN + '거래일 안입니다. 처음 <b>' + warm
        + '거래일</b>은 MA' + P.MA_LEN + ' 이 없어 돌파 주문이 나가지 않고 그리드만 돕니다.'
      : '지표(돌파 MA' + P.MA_LEN + ' · 정배열 MA' + P.MA_FAST + '/MA' + P.MA_SLOW
        + ' · 주봉 RSI)는 CSV 전체로 계산하고 선택 구간에서만 매매합니다. '
        + '시작일 기준 MA' + P.MA_LEN + ' 은 이전 ' + P.MA_LEN + '거래일로 이미 서 있습니다.';

    renderStats(st, r, init);
    renderCharts(BARS, r, st, i0, i1, init, conf);
    renderYears(r.eq, init);
    renderTrades(r, st);
    renderCompare(BARS, i0, i1, init, conf);
  }

  function statTile(label, value, sub, cls, hero) {
    return '<div class="stat' + (hero ? ' hero' : '') + '"><span>' + esc(label) + '</span>'
      + '<b' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(value) + '</b>'
      + '<small>' + (sub || '') + '</small></div>';
  }

  function renderStats(st, r, init) {
    var mult = st.final / init;
    // 1년 미만 구간의 CAGR 은 연 환산이라 과장된다 (4거래일 +1.7% → +365%).
    // 그런 구간에서는 총수익률을 앞세우고 CAGR 은 부가정보로 내린다.
    var shortRun = st.yrs < 1;
    $('statRow').innerHTML =
      (shortRun
        ? statTile('총수익률', signPct(st.total), '연 환산 CAGR ' + signPct(st.cagr, 1)
          + ' — 구간이 ' + num(st.yrs, 2) + '년이라 과장된 값입니다',
          st.total >= 0 ? 'up' : 'down', true)
        : statTile('CAGR', signPct(st.cagr), '총수익률 ' + signPct(st.total, 1)
          + ' · ' + num(mult, mult >= 100 ? 0 : 1) + '배', st.cagr >= 0 ? 'up' : 'down', true))
      + statTile('MDD', pct(st.mdd), '고점 ' + esc(st.mddFrom) + ' → 저점 ' + esc(st.mddAt), 'down')
      + statTile('Calmar', num(st.calmar), 'CAGR ÷ |MDD|')
      + statTile('최종 자산', compact(st.final), money(st.final))
      + statTile('최대 언더워터', st.maxuw.toLocaleString('en-US') + '일',
        '고점 회복까지 걸린 최장 거래일')
      + statTile('최대 주식 노출', pct(r.maxGross, 0), '총자산 대비 보유 평가액 최대치');
    $('perfNote').innerHTML = '초기 자본 <b>' + money(init) + '</b> · 수수료 편도 '
      + pct(P.FEE, 1) + ' 반영 · 슬리피지와 세금은 반영하지 않았습니다.';
  }

  // ── 차트 ────────────────────────────────────────────────
  var hoverAPI = [];   // 두 차트의 크로스헤어를 같은 인덱스로 묶는다

  function niceTicks(lo, hi, log) {
    var out = [];
    if (log) {
      var e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi));
      for (var e = e0; e <= e1; e++) {
        [1, 2, 5].forEach(function (m) {
          var v = m * Math.pow(10, e);
          if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
        });
      }
      if (out.length > 7) out = out.filter(function (v, i) { return i % 2 === 0; });
      if (out.length < 2) out = [lo, hi];
      return out;
    }
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    [1, 2, 2.5, 5, 10].some(function (m) {
      if (span / (step * m) <= 5) { step = step * m; return true; }
      return false;
    });
    for (var v2 = Math.ceil(lo / step) * step; v2 <= hi + 1e-9; v2 += step) out.push(v2);
    return out;
  }

  function xTicks(dates) {
    var marks = [], prevY = null, prevM = null;
    for (var i = 0; i < dates.length; i++) {
      var y = dates[i].slice(0, 4);
      if (y !== prevY) { marks.push({ i: i, label: y }); prevY = y; }
    }
    if (marks.length <= 2) {                 // 짧은 구간이면 월로 표시
      marks = []; prevM = null;
      for (var j = 0; j < dates.length; j++) {
        var m = dates[j].slice(0, 7);
        if (m !== prevM) { marks.push({ i: j, label: m.slice(2) }); prevM = m; }
      }
    }
    var maxN = 12;
    if (marks.length > maxN) {
      var step = Math.ceil(marks.length / maxN);
      marks = marks.filter(function (_, k) { return k % step === 0; });
    }
    return marks;
  }

  /** 여러 계열을 하나의 x 인덱스 위에 그린다. 계열은 모두 같은 날짜 배열을 쓴다. */
  function lineChart(el, dates, series, opt) {
    opt = opt || {};
    var W = el.clientWidth || 700, H = el.clientHeight || 300;
    var padL = 54, padR = opt.labels === false ? 14 : 76, padT = 10, padB = 22;
    var pw = Math.max(10, W - padL - padR), ph = Math.max(10, H - padT - padB);
    var n = dates.length;
    var vals = [];
    series.forEach(function (s) { s.points.forEach(function (v) { if (Number.isFinite(v)) vals.push(v); }); });
    if (!vals.length) { el.innerHTML = ''; return null; }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var log = opt.log && lo > 0;
    if (opt.zeroTop) { hi = 0; }                       // 낙폭 차트: 위쪽은 항상 0
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.06;
    if (!log) { lo -= pad; hi += pad; if (opt.zeroTop) hi = 0; }
    var tl = log ? Math.log10(lo) : lo, th = log ? Math.log10(hi) : hi;
    if (log) { var sp = th - tl; tl -= sp * 0.04; th += sp * 0.04; }

    var X = function (i) { return padL + (n <= 1 ? 0 : (i / (n - 1)) * pw); };
    var Y = function (v) {
      var t = log ? Math.log10(Math.max(v, 1e-9)) : v;
      return padT + ph - ((t - tl) / (th - tl)) * ph;
    };

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">'];
    // y 격자 + 눈금
    niceTicks(lo, hi, log).forEach(function (v) {
      var y = Y(v);
      if (y < padT - 2 || y > padT + ph + 2) return;
      svg.push('<line class="gl" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (padL + pw)
        + '" y2="' + y.toFixed(1) + '" />');
      svg.push('<text class="ax" x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1)
        + '" text-anchor="end">' + esc(opt.fmtY ? opt.fmtY(v) : compact(v)) + '</text>');
    });
    // x 눈금
    xTicks(dates).forEach(function (m) {
      var x = X(m.i);
      svg.push('<text class="ax" x="' + x.toFixed(1) + '" y="' + (padT + ph + 15)
        + '" text-anchor="middle">' + esc(m.label) + '</text>');
    });

    // 계열
    series.forEach(function (s, si) {
      if (s.area) {
        var a = ['M' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1)];
        s.points.forEach(function (v, i) { a.push('L' + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)); });
        a.push('L' + X(n - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z');
        svg.push('<path class="ddfill" d="' + a.join('') + '" />');
      }
      var d = '';
      s.points.forEach(function (v, i) {
        d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      });
      svg.push('<path class="' + (s.area ? 'ddline' : 'ln') + '" d="' + d + '"'
        + (s.area ? '' : ' stroke="' + s.color + '"') + ' data-s="' + si + '" />');
    });

    // 선 끝 이름표 — 색만으로 계열을 구분하지 않는다
    if (opt.labels !== false) {
      var ends = series.map(function (s, si) {
        return { si: si, y: Y(s.points[n - 1]), name: s.name, color: s.color };
      }).sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < ends.length; k++) {
        if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
      }
      ends.forEach(function (e) {
        svg.push('<text class="tag-end" x="' + (padL + pw + 7) + '" y="' + (e.y + 4).toFixed(1)
          + '" fill="' + e.color + '">' + esc(e.name) + '</text>');
      });
    }

    // 크로스헤어 (마우스 이동 때만 보인다)
    svg.push('<g class="hover" style="display:none">');
    svg.push('<line class="cross" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + ph) + '" />');
    series.forEach(function (s) {
      svg.push('<circle class="dot" r="4" cx="0" cy="0" fill="' + (s.area ? css('--bad') : s.color) + '" />');
    });
    svg.push('</g></svg>');

    el.innerHTML = svg.join('');
    var g = el.querySelector('g.hover');
    var line = g.querySelector('line'), dots = g.querySelectorAll('circle');
    return {
      el: el, X: X, Y: Y, n: n,
      show: function (i) {
        g.style.display = '';
        var x = X(i);
        line.setAttribute('x1', x); line.setAttribute('x2', x);
        series.forEach(function (s, si) {
          dots[si].setAttribute('cx', x);
          dots[si].setAttribute('cy', Y(s.points[i]));
        });
      },
      hide: function () { g.style.display = 'none'; },
      idxAt: function (px) {
        var t = (px - padL) / pw;
        return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
      }
    };
  }

  function attachHover(el, chart, dates, rows) {
    var old = el.querySelector('.hitlayer');
    if (old) old.remove();
    var hit = document.createElement('div');
    hit.className = 'hitlayer';
    el.appendChild(hit);
    var tip = $('tip');

    function move(ev) {
      var box = el.getBoundingClientRect();
      var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
      var i = chart.idxAt(cx * (el.clientWidth / box.width));
      hoverAPI.forEach(function (c) { if (c) c.show(i); });
      tip.hidden = false;
      tip.innerHTML = '<h5>' + esc(dates[i]) + '</h5>' + rows.map(function (r) {
        return '<div><em><i style="background:' + r.color + '"></i>' + esc(r.name) + '</em><b>'
          + esc(r.fmt(i)) + '</b></div>';
      }).join('');
      var tw = tip.offsetWidth, th2 = tip.offsetHeight;
      var px = (ev.touches ? ev.touches[0].clientX : ev.clientX) + 14;
      var py = (ev.touches ? ev.touches[0].clientY : ev.clientY) - th2 - 12;
      if (px + tw > window.innerWidth - 8) px = window.innerWidth - tw - 8;
      if (py < 8) py = (ev.touches ? ev.touches[0].clientY : ev.clientY) + 18;
      tip.style.left = px + 'px'; tip.style.top = py + 'px';
    }
    function out() {
      hoverAPI.forEach(function (c) { if (c) c.hide(); });
      $('tip').hidden = true;
    }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', out);
    hit.addEventListener('touchstart', move, { passive: true });
    hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('touchend', out);
  }

  var lastDraw = null;   // 리사이즈 때 같은 결과로 다시 그리기 위해 보관

  function renderCharts(B, r, st, i0, i1, init, conf) {
    var dates = r.eq.map(function (x) { return x[0]; });
    var series = [{ name: '전략', color: css('--s1'), points: r.eq.map(function (x) { return x[1]; }) }];

    if (input.cmpBH) {
      series.push({
        name: 'B&H', color: css('--s2'),
        points: BT.buyHold(B, i0, i1, init).map(function (x) { return x[1]; })
      });
    }
    var alt = input.alloc === 'grid'
      ? { label: '동적 30:70', wBo: null } : { label: '그리드 단독', wBo: 0 };
    $('cmpAltLabel').textContent = alt.label;
    if (input.cmpAlt) {
      var ar = BT.run(B, { i0: i0, i1: i1, wBo: alt.wBo, bosOn: !!input.bos, init: init });
      series.push({
        name: alt.label.length > 8 ? '비교' : alt.label, color: css('--s3'),
        points: ar.eq.map(function (x) { return x[1]; }), full: alt.label
      });
    }

    var dd = BT.drawdown(r.eq).map(function (x) { return x[1]; });

    lastDraw = function () {
      hoverAPI = [];
      var c1 = lineChart($('eqChart'), dates, series, { log: input.scale === 'log' });
      var c2 = lineChart($('ddChart'), dates, [{
        name: '낙폭', color: css('--bad'), points: dd, area: true
      }], { zeroTop: true, labels: false, fmtY: function (v) {
        return ((Math.abs(v) < 1e-9 ? 0 : v) * 100).toFixed(0) + '%';
      } });
      hoverAPI = [c1, c2];

      var rows = series.map(function (s) {
        return {
          name: s.full || s.name, color: s.color,
          fmt: function (i) { return money2(s.points[i]); }
        };
      });
      rows.push({
        name: '낙폭', color: css('--bad'),
        fmt: function (i) { return (dd[i] * 100).toFixed(2) + '%'; }
      });
      if (c1) attachHover($('eqChart'), c1, dates, rows);
      if (c2) attachHover($('ddChart'), c2, dates, rows);
    };
    lastDraw();

    $('eqLegend').innerHTML = series.map(function (s) {
      var last = s.points[s.points.length - 1];
      return '<span class="lg"><i style="background:' + s.color + '"></i>'
        + esc(s.full || s.name) + ' <b>' + compact(last) + '</b></span>';
    }).join('') + '<span class="lg"><i style="background:' + css('--bad')
      + '"></i>낙폭 <b>최대 ' + pct(st.mdd, 1) + '</b></span>';
  }

  // ── 표 ──────────────────────────────────────────────────
  function renderYears(eq, init) {
    var an = BT.annual(eq, init), am = BT.annualMdd(eq);
    var mddBy = {}; am.forEach(function (x) { mddBy[x.year] = x.mdd; });
    var lastBy = {}; eq.forEach(function (x) { lastBy[x[0].slice(0, 4)] = x[1]; });
    var firstY = eq[0][0].slice(0, 4), lastY = eq[eq.length - 1][0].slice(0, 4);
    var partialStart = eq[0][0].slice(5) > '01-10';
    var partialEnd = eq[eq.length - 1][0].slice(5) < '12-20';
    var mx = Math.max.apply(null, an.map(function (a) { return Math.abs(a.ret); }).concat([0.01]));

    $('yearRows').innerHTML = an.map(function (a) {
      var w = Math.abs(a.ret) / mx * 50;
      var part = (a.year === firstY && partialStart) || (a.year === lastY && partialEnd);
      return '<tr' + (part ? ' class="part"' : '') + '>'
        + '<td class="num">' + esc(a.year) + '</td>'
        + '<td class="num ' + (a.ret >= 0 ? 'up' : 'down') + '">' + signPct(a.ret) + '</td>'
        + '<td class="barcell"><div class="bar"><u></u><i class="' + (a.ret >= 0 ? 'p' : 'n')
        + '" style="' + (a.ret >= 0 ? 'left:50%;width:' : 'right:50%;width:') + w.toFixed(1)
        + '%"></i></div></td>'
        + '<td class="num down">' + pct(mddBy[a.year], 1) + '</td>'
        + '<td class="num">' + money(lastBy[a.year]) + '</td></tr>';
    }).join('');
    $('yearTag').textContent = an.length + '개 연도';
  }

  function renderTrades(r, st) {
    var rows = [
      { name: 'SOXL 돌파', s: BT.tradeStats(r.bo.trades.SOXL) },
      { name: 'SOXS 돌파', s: BT.tradeStats(r.bo.trades.SOXS) },
      { name: 'SOXL 그리드', s: BT.tradeStats(r.grid.trades) }
    ];
    $('tradeRows').innerHTML = rows.map(function (x) {
      if (!x.s.n) {
        return '<tr class="dim"><td>' + esc(x.name) + '</td>'
          + '<td class="num">0</td><td colspan="5" class="cond">체결 없음</td></tr>';
      }
      return '<tr><td>' + esc(x.name) + '</td>'
        + '<td class="num">' + x.s.n.toLocaleString('en-US') + '건</td>'
        + '<td class="num">' + (st.yrs > 0 ? (x.s.n / st.yrs).toFixed(0) : '—') + '/년</td>'
        + '<td class="num">' + pct(x.s.win, 1) + '</td>'
        + '<td class="num ' + (x.s.avg >= 0 ? 'up' : 'down') + '">' + signPct(x.s.avg, 3) + '</td>'
        + '<td class="num up">' + signPct(x.s.best, 1) + '</td>'
        + '<td class="num down">' + signPct(x.s.worst, 1) + '</td></tr>';
    }).join('');
    var tot = rows.reduce(function (s, x) { return s + (x.s.n || 0); }, 0);
    $('tradeTag').textContent = '총 ' + tot.toLocaleString('en-US') + '건 청산';
  }

  function renderCompare(B, i0, i1, init, conf) {
    var list = [
      { name: conf.label + (input.bos ? '' : ' · SOXS 없이') + ' (선택)', wBo: conf.wBo, bos: input.bos, sel: true },
      { name: '동적 30:70 / 20:80', wBo: null, bos: true },
      { name: '고정 20:80', wBo: P.W_BASE, bos: true },
      { name: '고정 30:70', wBo: P.W_STRONG, bos: true },
      { name: 'SOXS 없이 (동적)', wBo: null, bos: false },
      { name: '그리드 단독', wBo: 0, bos: true },
      { name: '돌파 단독', wBo: 1, bos: true }
    ];
    var html = list.map(function (x) {
      var rr = BT.run(B, { i0: i0, i1: i1, wBo: x.wBo, bosOn: x.bos, init: init });
      var s = BT.stats(rr.eq, init);
      return row(x.name, s, x.sel);
    });
    var bh = BT.stats(BT.buyHold(B, i0, i1, init), init);
    html.push(row('Buy & Hold (SOXL)', bh, false));
    $('cmpRows').innerHTML = html.join('');
    $('cmpTag').textContent = list.length + 1 + '개 구성';

    function row(name, s, sel) {
      return '<tr' + (sel ? ' class="sel"' : '') + '><td>' + esc(name) + '</td>'
        + '<td class="num ' + (s.cagr >= 0 ? 'up' : 'down') + '">' + signPct(s.cagr) + '</td>'
        + '<td class="num down">' + pct(s.mdd) + '</td>'
        + '<td class="num">' + num(s.calmar) + '</td>'
        + '<td class="num">' + s.maxuw.toLocaleString('en-US') + '일</td>'
        + '<td class="num">' + money(s.final) + '</td></tr>';
    }
  }

  // ── 입력 ────────────────────────────────────────────────
  function syncInputs() {
    $('fromDate').value = input.from;
    $('toDate').value = input.to;
    $('initCash').value = input.init;
    $('allocMode').value = input.alloc;
    $('bosOn').checked = !!input.bos;
    $('cmpBH').checked = !!input.cmpBH;
    $('cmpAlt').checked = !!input.cmpAlt;
    $('scaleSeg').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.scale === input.scale);
    });
  }

  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  function change(id, key, cast) {
    on(id, 'change', function (e) {
      input[key] = cast ? cast(e.target) : e.target.value;
      save(); render();
    });
  }
  change('fromDate', 'from');
  change('toDate', 'to');
  change('initCash', 'init', function (t) { return Math.max(1, Number(t.value) || 100000); });
  change('allocMode', 'alloc');
  change('bosOn', 'bos', function (t) { return t.checked; });
  change('cmpBH', 'cmpBH', function (t) { return t.checked; });
  change('cmpAlt', 'cmpAlt', function (t) { return t.checked; });

  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-preset]');
    if (!b || !BARS) return;
    var r = presetRange(b.dataset.preset);
    input.from = r[0] < BARS[0].d ? BARS[0].d : r[0];
    input.to = r[1];
    save(); syncInputs(); render();
  });

  $('scaleSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-scale]');
    if (!b) return;
    input.scale = b.dataset.scale;
    save(); syncInputs();
    if (lastDraw) lastDraw();
  });

  on('reloadCsv', 'click', function () { loadRemote(true); });
  on('printBtn', 'click', function () { window.print(); });

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (lastDraw) lastDraw(); }, 150);
  });

  syncInputs();
  loadRemote(false);
})();
