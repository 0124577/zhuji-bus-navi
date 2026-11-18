/* 去哪：直达优先 / 最少换乘 / 历史记录（全部本地静态数据计算） */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;
  const HIST_KEY = 'zjbus.history.v1';

  const G = { from: '', to: '', plans: [], idx: 0, computing: false, tip: '', walk: null, allClosed: false, note: '' };

  /* ---------- 历史 ---------- */
  function history() { return ZJ.Store.get(HIST_KEY, []); }
  function pushHistory(from, to) {
    const list = history().filter((h) => !(h.from === from && h.to === to));
    list.unshift({ from: from, to: to, ts: Date.now() });
    ZJ.Store.set(HIST_KEY, list.slice(0, 20));
  }
  function fmtWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return (sameDay ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + ZJ.pad(d.getHours()) + ':' + ZJ.pad(d.getMinutes());
  }

  function renderHistory() {
    const list = history();
    if (!list.length) {
      $('histList').innerHTML = '<div class="empty-block">还没有搜索记录<br>查询一次换乘方案就会自动保存</div>';
      return;
    }
    $('histList').innerHTML = list.map((h, i) =>
      '<div class="hist-row" data-act="hist-open" data-i="' + i + '">' +
      '<div class="hist-main"><b>' + ZJ.esc(h.from) + ' → ' + ZJ.esc(h.to) + '</b><span>' + fmtWhen(h.ts) + '</span></div>' +
      '<button class="hist-del" data-act="hist-del" data-i="' + i + '"><svg class="ico"><use href="#i-trash"/></svg></button>' +
      '</div>').join('');
  }

  /* ---------- 选择器 ---------- */
  function renderSelectors() {
    const fc = $('fromName'), tc = $('toName');
    fc.textContent = G.from || '选择起点站';
    tc.textContent = G.to || '选择终点站';
    fc.classList.toggle('ph', !G.from);
    tc.classList.toggle('ph', !G.to);
  }

  /* ---------- 方案计算 ---------- */
  function makeLeg(dir, fromOrder, toOrder) {
    return {
      line: dir.line,
      dir: dir,
      fromOrder: fromOrder,
      toOrder: toOrder,
      from: dir.stops[fromOrder - 1].name,
      to: dir.stops[toOrder - 1].name,
      stops: toOrder - fromOrder,
      meters: Math.max(0, dir.stops[toOrder - 1].cum - dir.stops[fromOrder - 1].cum),
      minutes: Data.rideMinutes(dir, fromOrder, toOrder),
      key: dir.id + ':' + fromOrder + '-' + toOrder
    };
  }
  function buildPlan(legs) {
    const transfers = Math.max(0, legs.length - 1);
    const ride = legs.reduce((s, l) => s + l.minutes, 0);
    const total = ride + transfers * 5;
    const meters = legs.reduce((s, l) => s + l.meters, 0);
    const stops = legs.reduce((s, l) => s + l.stops, 0);
    return { legs: legs, transfers: transfers, total: total, ride: ride, meters: meters, stops: stops, key: legs.map((l) => l.key).join('>') };
  }
  function dedupe(list, limit) {
    const map = new Map();
    list.forEach((p) => {
      const old = map.get(p.key);
      if (!old || p.total < old.total) map.set(p.key, p);
    });
    return [...map.values()].sort((a, b) => a.transfers - b.transfers || a.total - b.total).slice(0, limit || 6);
  }

  function findDirect(from, to) {
    const out = [];
    const a = Data.stationMap.get(from), b = Data.stationMap.get(to);
    if (!a || !b) return out;
    a.entries.forEach((x) => b.entries.forEach((y) => {
      if (x.dir === y.dir && y.order > x.order) out.push(buildPlan([makeLeg(x.dir, x.order, y.order)]));
    }));
    return dedupe(out);
  }

  function endReach(to) {
    const map = new Map();
    const best = new Map();
    const t = Data.stationMap.get(to);
    if (!t) return { map: map, best: best };
    t.entries.forEach((e) => {
      const d = e.dir;
      for (let o = 1; o < e.order; o++) {
        if (!map.has(d.id)) map.set(d.id, new Map());
        const m = Data.rideMinutes(d, o, e.order);
        const old = map.get(d.id).get(o);
        if (!old || m < old.minutes) map.get(d.id).set(o, { entry: e, minutes: m });
      }
    });
    map.forEach((orders, dirId) => {
      const d = Data.dirs.get(dirId);
      orders.forEach((v, order) => {
        const name = d.stops[order - 1].name;
        const old = best.get(name);
        if (!old || v.minutes < old.minutes) best.set(name, { dir: d, boardOrder: order, entry: v.entry, minutes: v.minutes });
      });
    });
    return { map: map, best: best };
  }

  function findTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    a.entries.forEach((x) => {
      const d = x.dir;
      for (let o = x.order + 1; o <= d.stops.length; o++) {
        const tName = d.stops[o - 1].name;
        if (tName === to) continue;
        const hub = Data.stationMap.get(tName);
        if (!hub) continue;
        hub.entries.forEach((y) => {
          if (y.dir === d) return;
          const next = (reach.map.get(y.dir.id) || new Map()).get(y.order);
          if (!next) return;
          out.push(buildPlan([makeLeg(d, x.order, o), makeLeg(y.dir, y.order, next.entry.order)]));
        });
      }
    });
    return dedupe(out);
  }

  function findTwoTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    let stopped = false;
    a.entries.forEach((x) => {
      if (stopped) return;
      const d1 = x.dir;
      for (let o1 = x.order + 1; o1 <= d1.stops.length && !stopped; o1++) {
        const h1 = d1.stops[o1 - 1].name;
        if (h1 === to) continue;
        const s1 = Data.stationMap.get(h1);
        if (!s1) continue;
        s1.entries.forEach((y) => {
          if (stopped || y.dir === d1) return;
          const d2 = y.dir;
          for (let o2 = y.order + 1; o2 <= d2.stops.length; o2++) {
            const h2 = d2.stops[o2 - 1].name;
            if (h2 === from || h2 === to || h2 === h1) continue;
            const c = reach.best.get(h2);
            if (!c || c.entry.dir === d2) continue;
            out.push(buildPlan([makeLeg(d1, x.order, o1), makeLeg(d2, y.order, o2), makeLeg(c.dir, c.boardOrder, c.entry.order)]));
            if (out.length > 200) { stopped = true; return; }
          }
        });
      }
    });
    return dedupe(out);
  }

  function renderTip(msg) {
    $('planResult').innerHTML =
      '<div class="plan-empty tip"><svg class="ico"><use href="#i-route"/></svg><b>' + ZJ.esc(msg) + '</b></div>';
  }

  function renderPrompt() {
    $('planResult').innerHTML =
      '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
      '<b>输入起点和终点</b>点上面两个框，选好站就会自动规划</div>';
  }

  /* ---------- 运营状态标注（每次渲染都按当前时间重算） ---------- */
  function annotate(p) {
    p.svcs = p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder));
    p.closed = p.svcs.some((s) => s.state === 'closed');
    p.before = p.svcs.some((s) => s.state === 'before');
    p.off = p.closed || p.before;
    p.lastGone = !p.off && p.svcs.some((s) => s.state === 'lastGone');
    const off = p.svcs.filter((s) => s.off)[0];
    p.offInfo = off || null;
    p.state = p.closed ? 'closed' : p.before ? 'before' : p.lastGone ? 'lastGone' : 'running';
    return p;
  }

  /* 近距离：直线距离 ≤ 1.2 公里时给出步行建议（步行速度按 70 米/分钟） */
  function walkInfo(from, to) {
    const a = Data.stationOf(from), b = Data.stationOf(to);
    if (!a || !b || !a.lat || !b.lat) return null;
    const meters = Math.round(ZJ.hav(a.lat, a.lng, b.lat, b.lng));
    if (!(meters > 0) || meters > 1200) return null;
    return { meters: meters, minutes: Math.max(1, Math.round(meters / 70)) };
  }

  function renderWalk(w) {
    if (!w) return '';
    return '<div class="walk-card">' +
      '<span class="walk-ico"><svg class="ico"><use href="#i-walk"/></svg></span>' +
      '<div class="walk-txt"><b>两地相距 ' + ZJ.distTxt(w.meters) + '，步行约 ' + w.minutes + ' 分钟</b>' +
      '<span>' + (w.meters <= 600 ? '距离很近，走路可能比等车更快' : '不赶时间的话步行也可以') +
      ' · 直线距离估算</span></div></div>';
  }

  function metric(label, val) {
    return '<div class="pm"><b>' + val + '</b><span>' + label + '</span></div>';
  }

  function legLines(p) {
    return p.legs.map((l) =>
      '<span class="pl-chain"><span class="leg-badge">' + ZJ.esc(l.line) + '</span>' +
      '<span>' + ZJ.esc(l.from) + ' → ' + ZJ.esc(l.to) + '</span></span>').join('<span class="pl-arrow">›</span>');
  }

  function legDetail(p) {
    return p.legs.map((l, i) => {
      const last = i === p.legs.length - 1;
      return '<div class="leg">' +
        '<div class="leg-top"><span class="leg-badge">' + ZJ.esc(l.line) + '</span>' +
        '<b>' + ZJ.esc(l.from) + ' → ' + ZJ.esc(l.to) + '</b></div>' +
        '<div class="leg-meta">' + (p.off
          ? '往 ' + ZJ.esc(l.dir.end) + ' · 运营时段 ' + ZJ.esc(l.dir.first) + ' – ' + ZJ.esc(l.dir.last)
          : '乘 ' + l.stops + ' 站 · 约 ' + l.minutes + ' 分钟 · 往 ' + ZJ.esc(l.dir.end)) + '</div>' +
        (last ? '<div class="leg-end">到 <b>' + ZJ.esc(l.to) + '</b> 下车</div>'
          : '<div class="leg-end">在 <b>' + ZJ.esc(l.to) + '</b> 同站换乘</div>') +
        '</div>';
    }).join('');
  }

  /* 复用详情页同一套横向站点时间轴组件 */
  function stripsHtml(p) {
    return p.legs.map((l, i) =>
      '<div class="pl-strip-h"><b>' + ZJ.esc(l.line) + ' 沿途站点</b>' +
      '<span class="tl-hint" id="goHint' + i + '" data-total="' + l.dir.stops.length + '">左右滑动浏览</span></div>' +
      '<div class="tl-scroll pl-strip" id="goSc' + i + '"><div class="tl tl-sm" id="goTl' + i + '"></div></div>').join('');
  }

  function mountStrips(p) {
    p.legs.forEach((l, i) => {
      const el = $('goTl' + i);
      if (!el) return;
      ZJ.Timeline.mount(l.dir, { el: el, board: l.fromOrder, alight: l.toOrder, focus: l.fromOrder, vehicles: [], stopAct: 'noop' });
      ZJ.Timeline.bindHint($('goSc' + i), $('goHint' + i));
    });
  }

  function planCard(p, i, n) {
    const sel = i === G.idx;
    /* 相邻站点里程可能为 0（官方站距缺失），此时不显示「0 米」 */
    const meters = p.meters >= 50 ? ZJ.distTxt(p.meters) : '相邻站点';
    let head, hero, sub, metrics;
    if (p.off) {
      const s = p.offInfo || p.svcs[0];
      head = '<span class="plan-no">方案 ' + (n + 1) + '</span>' +
        '<span class="plan-tag gray">' + (p.closed ? '已收班' : '首班未发') + '</span>';
      hero = '<div class="plan-hero off">' + (p.closed ? '已收班' : '首班未发') +
        '<span class="kind gray">' + ZJ.esc(ZJ.Service.note(s)) + '</span></div>';
      sub = ZJ.esc(ZJ.Service.resume(s)) + ' · 运营时段 ' + ZJ.esc(s.firstTxt) + ' – ' + ZJ.esc(s.lastTxt);
      metrics = metric('换乘', p.transfers ? p.transfers + ' 次' : '直达') +
        metric('里程', meters) + metric('首班', ZJ.esc(s.firstTxt)) + metric('末班', ZJ.esc(s.lastTxt));
    } else {
      head = '<span class="plan-no">方案 ' + (n + 1) + '</span>' +
        '<span class="plan-tag">' + (p.transfers === 0 ? '直达' : p.transfers + ' 次换乘') + '</span>' +
        (n === 0 ? '<span class="plan-tag rec">推荐</span>' : '') +
        (p.lastGone ? '<span class="plan-tag warn">末班车已发出</span>' : '');
      hero = '<div class="plan-hero">到目的地还有 <b>' + p.stops + '</b> 站' +
        '<span class="kind' + (p.transfers ? ' tf' : '') + '">' + (p.transfers === 0 ? '直达' : '换乘 ' + p.transfers + ' 次') + '</span></div>';
      sub = '约 <b>' + p.total + '</b> 分钟 · ' + ZJ.minHM(ZJ.nowMin() + p.total) + ' 到达 · ' + meters;
      metrics = metric('耗时', p.total + ' 分') + metric('站数', p.stops + ' 站') +
        metric('换乘', p.transfers ? p.transfers + ' 次' : '0 次') + metric('里程', meters);
    }
    return '<div class="plan-card plan-cardlink' + (sel ? ' sel' : '') + (p.off ? ' off' : '') + '"' +
      ' data-act="plan-pick" data-i="' + i + '">' +
      '<div class="plan-head">' + head + '</div>' +
      hero +
      '<div class="plan-sub">' + sub + '</div>' +
      '<div class="plan-metrics">' + metrics + '</div>' +
      (sel ? '' : '<div class="plan-chain">' + legLines(p) + '</div>') +
      (sel
        ? '<div class="plan-body">' + legDetail(p) + (p.off ? '' : stripsHtml(p)) +
          '<button class="plan-open-btn" data-act="plan-open" data-i="' + i + '">' +
          (p.off ? '查看站点与运营时段' : '看实时车辆与到站提醒') +
          '<svg class="ico"><use href="#i-right"/></svg></button></div>'
        : '<div class="plan-peek">展开分段与实时车辆<svg class="ico"><use href="#i-right"/></svg></div>') +
      '</div>';
  }

  function renderPlans() {
    if (!G.plans.length) {
      $('planResult').innerHTML =
        '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>暂无可用方案</b>「' + ZJ.esc(G.from) + '」到「' + ZJ.esc(G.to) + '」没有直达或换乘线路<br>可以换一个邻近站点试试</div>';
      return;
    }
    /* 每次渲染都重算运营状态：跨过末班时间会自动切换为「已收班」 */
    G.plans.forEach(annotate);
    G.sig = G.plans.map((p) => p.svcs.map((s) => s.state).join(',')).join('|');

    /* 收班过滤：还有可用方案时不再展示已收班的；全部收班时全部保留并标为「明日参考」 */
    const avail = G.plans.filter((p) => !p.off);
    G.allClosed = avail.length === 0;
    const shown = avail.length ? avail : G.plans;
    if (G.idx < 0 || !shown.some((p) => p === G.plans[G.idx])) G.idx = G.plans.indexOf(shown[0]);
    G.visible = shown.length;

    const idxOf = (p) => G.plans.indexOf(p);
    const tabs = shown.map((p) =>
      '<button class="plan-tab ' + (idxOf(p) === G.idx ? 'on' : '') + (p.off ? ' off' : '') + '" data-act="plan-idx" data-i="' + idxOf(p) + '">' +
      '<b>' + (p.transfers === 0 ? '直达' : p.transfers + ' 次换乘') + '</b>' +
      '<span>' + p.legs.map((l) => l.line).join(' › ') + ' · ' + (p.off ? '已收班' : p.total + ' 分钟') + '</span></button>').join('');

    const banner = G.allClosed
      ? '<div class="degrade-banner soft"><svg class="ico"><use href="#i-clock"/></svg>' +
        '<div><b>今日末班已过</b><span>以下为明日可乘方案，末班车发出后不再显示剩余站数</span></div></div>'
      : '';

    const list = shown.map((p, n) => planCard(p, idxOf(p), n)).join('');
    $('planResult').innerHTML = banner + renderWalk(G.walk) +
      '<div class="plan-tabs">' + tabs + '</div>' +
      '<div class="plan-list">' + list + '</div>';
    const p = G.plans[G.idx];
    if (p && !p.off) mountStrips(p);
  }

  function plan() {
    if (!G.from) { ZJ.toast('请先选择起点站'); return; }
    if (!G.to) { ZJ.toast('请先选择终点站'); return; }
    /* 同站：清掉上一次结果，避免显示与当前起终点对不上的方案 */
    if (G.from === G.to) {
      G.plans = []; G.idx = 0; G.computing = false;
      renderTip('起点和终点不能是同一个站，请换一个');
      ZJ.toast('起点和终点不能是同一个站');
      return;
    }
    if (G.computing) return;
    G.tip = '';
    pushHistory(G.from, G.to);
    renderHistory();
    G.computing = true;
    $('planResult').innerHTML = '<div class="plan-empty"><b>正在计算出行方案…</b>直达优先，其次比较换乘次数</div>';
    setTimeout(() => {
      /* 直达优先：有直达时同时给出若干换乘备选，便于按耗时 / 少走路自行挑 */
      const direct = findDirect(G.from, G.to);
      let plans = direct;
      if (direct.length < 3) {
        const reach = endReach(G.to);
        const alt = findTransfer(G.from, G.to, reach);
        plans = dedupe(direct.concat(alt), 6);
        if (!plans.length) plans = findTwoTransfer(G.from, G.to, reach);
      }
      plans = plans.map(annotate);

      /* 收班过滤：优先只留下仍在运营的方案；全部收班时全部保留并标注「明日」 */
      const avail = plans.filter((p) => !p.off);
      G.allClosed = plans.length > 0 && avail.length === 0;
      const picked = avail.length ? avail : plans;
      picked.sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || a.transfers - b.transfers || a.total - b.total);

      G.plans = picked;
      G.idx = 0;
      G.walk = walkInfo(G.from, G.to);
      G.computing = false;
      renderPlans();
      const closedCount = picked.filter((p) => p.off).length;
      if (!picked.length) ZJ.toast('暂无可行方案');
      else if (G.allClosed) ZJ.toast('今日末班已过，已列出明日方案');
      else ZJ.toast('找到 ' + picked.length + ' 套方案' + (closedCount ? '（' + closedCount + ' 套已收班）' : ''));
    }, 40);
  }

  function openNearby() {
    const list = ZJ.Geo && ZJ.Geo.state === 'ok' ? Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 8) : [];
    if (!list.length) {
      ZJ.toast('还没定位成功，请检查定位权限');
      ZJ.Geo.locate(true).then(() => openNearby()).catch(() => {});
      return;
    }
    ZJ.UI.sheet(
      '<div class="sheet-h"><b>选择附近的站点</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body"><div class="pick-stops">' +
      list.map((x) => '<button class="pick-stop" data-act="pick-near" data-name="' + ZJ.esc(x.station.name) + '">' +
        ZJ.esc(x.station.name) + ' · ' + ZJ.distTxt(x.dist) + '</button>').join('') +
      '</div><p class="sheet-note">距离为直线距离估算，仅供参考</p></div>'
    );
  }

  const Go = {
    render() {
      renderSelectors();
      renderHistory();
      if (!G.from || !G.to) renderPrompt();
      else if (!G.plans.length) { if (G.tip) renderTip(G.tip); else renderPrompt(); }
      else renderPlans();
    },
    plan: plan,
    state() { return G; },
    /* 供定时器调用：运营状态变化时才重绘，避免打断正在浏览的卡片 */
    tick() {
      if (!G.plans.length) return;
      if (!document.getElementById('page-go').classList.contains('on')) return;
      const sig = G.plans.map((p) => p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder).state).join(',')).join('|');
      const allClosed = G.plans.every((p) => p.legs.every((l) => ZJ.Service.info(l.dir, l.fromOrder).state === 'closed'));
      if (sig === G.sig && allClosed === G.allClosed) return;
      G.sig = sig;
      renderPlans();
    }
  };
  ZJ.Go = Go;

  /* 每 30 秒检查一次运营状态：跨过末班时间会自动切换为「已收班」，无需用户操作 */
  setInterval(() => { try { Go.tick(); } catch (e) {} }, 30000);

  /* ---------- 动作 ---------- */
  function pickEnd(which, name) {
    const other = which === 'from' ? G.to : G.from;
    if (name && name === other) { ZJ.toast('起点和终点不能是同一个站'); return; }
    if (which === 'from') G.from = name; else G.to = name;
    G.tip = '';
    renderSelectors();
    if (G.from && G.to) plan();
  }
  ZJ.act('pick-from', () => ZJ.Picker.open('选择起点站', null, (name) => pickEnd('from', name)));
  ZJ.act('pick-to', () => ZJ.Picker.open('选择终点站', null, (name) => pickEnd('to', name)));
  ZJ.act('pick-my', (el, e) => { if (e) e.stopPropagation(); openNearby(); });
  ZJ.act('swap-stops', (el, e) => {
    if (e) e.stopPropagation();
    const t = G.from; G.from = G.to; G.to = t;
    renderSelectors();
    if (G.from && G.to) plan();
  });
  ZJ.act('plan', () => plan());
  ZJ.act('pick-near', (el) => {
    const name = el.dataset.name;
    if (name === G.to) { ZJ.toast('起点和终点不能是同一个站'); return; }
    G.from = name;
    G.tip = '';
    ZJ.UI.closeSheet();
    renderSelectors();
    ZJ.toast('起点已设为「' + G.from + '」');
    if (G.to) plan();
  });
  ZJ.act('plan-idx', (el, e) => { if (e) e.stopPropagation(); G.idx = +el.dataset.i; renderPlans(); });
  /* 点任意方案卡即切换查看（已展开的卡片再点不动作，避免误触） */
  ZJ.act('plan-pick', (el) => {
    const i = +el.dataset.i;
    if (i === G.idx) return;
    G.idx = i;
    renderPlans();
  });
  ZJ.act('plan-open', (el, e) => {
    if (e && e.target.closest('.plan-tab')) return;
    const i = el && el.dataset && el.dataset.i != null ? +el.dataset.i : G.idx;
    const p = G.plans[i] || G.plans[G.idx] || G.plans[0];
    if (!p) { ZJ.toast('请先生成出行方案'); return; }
    if (!ZJ.Plan || !ZJ.Plan.open) { ZJ.toast('方案详情暂不可用'); return; }
    ZJ.Plan.open(p, G.from, G.to);
  });
  ZJ.act('hist-open', (el) => {
    const h = history()[+el.dataset.i];
    if (!h) return;
    G.from = h.from; G.to = h.to;
    renderSelectors();
    plan();
  });
  ZJ.act('hist-del', (el, e) => {
    if (e) e.stopPropagation();
    const list = history();
    list.splice(+el.dataset.i, 1);
    ZJ.Store.set(HIST_KEY, list);
    renderHistory();
    ZJ.toast('已删除该记录');
  });
  ZJ.act('clear-hist', () => {
    if (!history().length) { ZJ.toast('暂无搜索记录'); return; }
    ZJ.Store.set(HIST_KEY, []);
    renderHistory();
    ZJ.toast('已清空搜索历史');
  });
})();
