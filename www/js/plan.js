/* 换乘方案详情页：分段线路实时公交 + 站点级到站提醒 + 横向站点列表 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;

  const P = {
    plan: null,
    from: '',
    to: '',
    data: new Map(), /* dirId -> { vehicles, err, at, loading } */
    req: 0,
    timer: null
  };

  function legData(leg) {
    return P.data.get(leg.dir.id) || { vehicles: [], err: '', at: 0, loading: !P.data.get(leg.dir.id) };
  }

  function arrivals(leg) {
    const d = legData(leg);
    return d.vehicles.length ? ZJ.RT.arrivalsTo(leg.dir, d.vehicles, leg.fromOrder) : [];
  }

  /* 各段中「最快到上车站」的一辆，用于顶部高亮条 */
  function soonest() {
    let best = null;
    P.plan.legs.forEach((leg, i) => {
      const b = arrivals(leg)[0];
      if (!b) return;
      const remain = b.atStation ? 0 : b.remain;
      if (!best || remain < best.remain) {
        best = {
          remain: remain, minutes: b.minutes, atStation: !!b.atStation,
          plate: b.v.plate || '', leg: leg, idx: i
        };
      }
    });
    return best;
  }

  /* 顶部大字「到目的地还有 N 站」：老年用户最先要看的一条信息（无实时车也给静态口径）
     首末班校验：不在运营时段（已收班 / 首班前）时不再给剩余站数与预估到达时间 */
  function hero() {
    const p = P.plan;
    const infos = p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder));
    const offIdx = infos.findIndex((i) => i.off);
    if (offIdx > -1) {
      const s = infos[offIdx];
      const closed = s.state === 'closed';
      return '<div class="pl-hl off">' +
        '<div class="pl-hl-l"><span class="pl-hl-txt">' + (closed ? '末班已发出' : '首班还未发车') + '</span>' +
        '<span class="pl-hl-num off">' + (closed ? '已收班' : '未发车') + '</span></div>' +
        '<div class="pl-hl-r"><b>' + ZJ.esc(ZJ.Service.note(s)) + '</b>' +
        '<span>' + ZJ.esc(ZJ.Service.resume(s)) + ' · 运营 ' + ZJ.esc(s.firstTxt) + '–' + ZJ.esc(s.lastTxt) + '</span></div></div>';
    }
    const stops = p.legs.reduce((a, l) => a + l.stops, 0);
    const arrive = ZJ.minHM(ZJ.nowMin() + p.total);
    const s = soonest();
    const anyErr = p.legs.some((l) => legData(l).err);
    const lastGone = infos.some((i) => i.state === 'lastGone');
    let sub;
    if (s) {
      sub = '<i class="live-dot"></i>' + ZJ.esc(s.leg.line) +
        (s.remain === 0 ? ' 车已到上车站' : ' 还有 ' + s.remain + ' 站到上车站');
    } else if (anyErr) {
      sub = '<i class="live-dot off"></i>实时不可用 · 按静态里程估算';
    } else {
      sub = '<i class="live-dot off"></i>暂无在线车辆 · 按静态里程估算';
    }
    if (lastGone) sub += ' · <span class="hot">末班车已发出</span>';
    return '<div class="pl-hl' + (s ? '' : ' static') + '"' +
      (s ? ' data-act="pl-hl" data-idx="' + s.idx + '"' : '') + '>' +
      '<div class="pl-hl-l"><span class="pl-hl-txt">到目的地还有</span>' +
      '<span class="pl-hl-num">' + stops + '<em>站</em></span></div>' +
      '<div class="pl-hl-r"><b>约 ' + p.total + ' 分钟 · ' + arrive + ' 到达</b>' +
      '<span>' + sub + '</span></div></div>';
  }

  /* ---------------- 汇总 ---------------- */
  function renderSummary() {
    const p = P.plan;
    const anyErr = p.legs.some((l) => legData(l).err);
    const noLive = p.legs.every((l) => !legData(l).vehicles.length);
    const staticMode = ZJ.Api.mode === 'static';
    const degraded = staticMode || anyErr;

    let banner = '';
    if (degraded) {
      banner = '<div class="degrade-banner"><svg class="ico"><use href="#i-refresh"/></svg>' +
        '<div><b>实时数据暂不可用，已自动降级</b><span>' +
        (staticMode ? '当前为静态数据模式，站点、首末班、换乘方案照常可用' : '实时接口请求失败，已使用静态线路数据（站序 / 首末班 / 里程估算）') +
        '</span></div><button data-act="plan-refresh">重试</button></div>';
    }

    $('plSummary').innerHTML = banner + hero();
  }

  /* ---------------- 单段卡片 ---------------- */
  function liveBlock(leg) {
    const d = legData(leg);
    const dir = leg.dir;
    /* 首末班校验：不在运营时段时直接给收班状态，不渲染剩余站数与到站时间 */
    const svc = ZJ.Service.info(dir, leg.fromOrder);
    if (svc.off) {
      const closed = svc.state === 'closed';
      return '<div class="pl-live empty off"><div class="pl-live-main"><b>' + (closed ? '已收班' : '首班未发') + '</b>' +
        '<span class="pl-eta">' + ZJ.esc(ZJ.Service.note(svc)) + '</span></div>' +
        '<div class="pl-live-sub">' + ZJ.esc(ZJ.Service.resume(svc)) + ' · 运营时段 ' +
        ZJ.esc(svc.firstTxt) + ' – ' + ZJ.esc(svc.lastTxt) + '，到站时间以运营时段为准</div></div>';
    }
    if (d.loading && !d.at) {
      return '<div class="pl-live"><div class="pl-live-loading"><span class="spin"></span>正在获取实时车辆…</div></div>';
    }
    if (d.err) {
      return '<div class="pl-live err"><div class="pl-live-main"><b>实时数据不可用</b></div>' +
        '<div class="pl-live-sub">' + ZJ.esc(d.err) + ' · 已按静态数据展示站点与首末班</div>' +
        '<button class="pl-retry" data-act="plan-refresh">重新获取</button></div>';
    }
    const list = arrivals(leg);
    const best = list[0];
    if (best) {
      const remain = best.atStation ? 0 : best.remain;
      const etaTxt = best.atStation ? '车辆已到上车站' : '约 ' + best.minutes + ' 分钟到上车站';
      return '<div class="pl-live">' +
        '<div class="pl-live-main"><span class="pl-remain"><i>' + (remain === 0 ? '已到' : '还有') + '</i><b>' + remain + '</b><em>站</em></span>' +
        '<span class="pl-eta">' + ZJ.esc(etaTxt) + '</span></div>' +
        '<div class="pl-live-sub"><i class="live-dot"></i>' + ZJ.esc(best.v.plate || '车辆') + ' · ' + ZJ.esc(ZJ.RT.positionText(dir, best.v)) + '</div>' +
        '</div>';
    }
    const head = svc.state === 'lastGone' ? '末班车已发出，暂无其他车辆' : '此刻暂无开往上车站的车辆';
    const sub = '本段按静态里程估算乘车约 ' + leg.minutes + ' 分钟，稍后自动刷新';
    return '<div class="pl-live empty"><div class="pl-live-main"><b>' + ZJ.esc(head) + '</b></div>' +
      '<div class="pl-live-sub">' + sub + '</div></div>';
  }

  /* 竖向时间轴（大字版）：仅渲染本段上车站 → 下车站，老年友好 */
  function vRows(leg) {
    const d = legData(leg);
    const svc = ZJ.Service.info(leg.dir, leg.fromOrder);
    return ZJ.VTimeline.html(leg.dir, {
      board: leg.fromOrder,
      alight: leg.toOrder,
      vehicles: d.vehicles,
      err: d.err,
      range: [leg.fromOrder, leg.toOrder],
      line: leg.line,
      dirKey: leg.dir.key,
      rowAct: 'noop',
      bellAct: 'pl-bell',
      bellClass: 'pl-bell',
      off: svc.off,
      offTxt: svc.state === 'before' ? '首班未发' : '已收班',
      staticEta: (o) => '静态约 ' + Math.max(1, Math.round(ZJ.Data.rideMeters(leg.dir, leg.fromOrder, o) / ZJ.CFG.AVG_SPEED + (o - leg.fromOrder) * ZJ.CFG.DWELL)) + ' 分钟'
    });
  }

  function renderLegs() {
    const p = P.plan;
    $('plLegs').innerHTML = p.legs.map((leg, i) => {
      const d = legData(leg);
      const svcOff = ZJ.Service.info(leg.dir, leg.fromOrder).off;
      const isLast = i === p.legs.length - 1;
      return '<section class="card pl-leg">' +
        '<div class="pl-leg-h"><span class="leg-badge">' + ZJ.esc(leg.line) + '</span>' +
        '<div class="pl-leg-t"><b>' + ZJ.esc(leg.from) + ' → ' + ZJ.esc(leg.to) + '</b>' +
        '<span>' + (svcOff
          ? '往 ' + ZJ.esc(leg.dir.end) + ' · 运营时段 ' + ZJ.esc(leg.dir.first) + ' – ' + ZJ.esc(leg.dir.last)
          : '往 ' + ZJ.esc(leg.dir.end) + ' · 乘 ' + leg.stops + ' 站 · 约 ' + leg.minutes + ' 分钟') + '</span></div>' +
        '<span class="pl-leg-idx">第 ' + (i + 1) + ' 段</span></div>' +
        liveBlock(leg) +
        '<div class="pl-hops">' +
        '<div class="pl-hop"><span class="lab">上车站</span><b>' + ZJ.esc(leg.from) + '</b><span class="ord">第 ' + leg.fromOrder + ' 站</span></div>' +
        '<div class="pl-hop"><span class="lab">下车站</span><b>' + ZJ.esc(leg.to) + '</b><span class="ord">第 ' + leg.toOrder + ' 站</span></div>' +
        '</div>' +
        '<div class="pl-strip-h"><b>线路站点</b><span class="tl-hint" id="plHint' + i + '" data-total="' + leg.dir.stops.length + '">左右滑动浏览</span></div>' +
        '<div class="tl-scroll pl-strip" id="plSc' + i + '"><div class="tl tl-sm" id="plTl' + i + '"></div></div>' +
        '<div class="pl-stops"><div class="pl-stops-h"><b>竖向时间轴 · 大字</b><span>点铃铛开关提醒</span></div>' +
        '<div class="vt vt-plan">' + vRows(leg) + '</div></div>' +
        (isLast
          ? '<div class="pl-leg-foot">到 <b>' + ZJ.esc(leg.to) + '</b> 下车，步行前往目的地</div>'
          : '<div class="pl-leg-foot">在 <b>' + ZJ.esc(leg.to) + '</b> 同站换乘，预留 5 分钟</div>') +
        '<button class="pl-open-line" data-act="pl-line" data-line="' + ZJ.esc(leg.line) + '" data-dir="' + ZJ.esc(leg.dir.key) +
        '" data-station="' + ZJ.esc(leg.from) + '">查看「' + ZJ.esc(leg.line) + '」实时车辆' +
        '<svg class="ico"><use href="#i-right"/></svg></button>' +
        '</section>';
    }).join('');
  }

  /* 重新挂载横向站点条，保持用户滚动位置 */
  function mountStrips(keep) {
    P.plan.legs.forEach((leg, i) => {
      const el = $('plTl' + i);
      if (!el) return;
      const d = legData(leg);
      ZJ.Timeline.mount(leg.dir, {
        el: el,
        board: leg.fromOrder,
        alight: leg.toOrder,
        vehicles: d.vehicles,
        focus: leg.fromOrder,
        restore: keep ? keep[i] : null,
        stopAct: 'noop'
      });
      ZJ.Timeline.bindHint($('plSc' + i), $('plHint' + i));
    });
  }

  function render(keepScroll) {
    if (!P.plan) return;
    const keep = keepScroll ? P.plan.legs.map((l, i) => {
      const sc = $('plSc' + i);
      return sc ? sc.scrollLeft : null;
    }) : null;
    renderSummary();
    renderLegs();
    mountStrips(keep);
  }

  /* ---------------- 数据 ---------------- */
  async function loadAll() {
    if (!P.plan) return;
    /* 全部段都已收班 / 首班前：不再请求实时接口，只按当前时间重绘（每次刷新都会重新判定） */
    const allOff = P.plan.legs.every((l) => ZJ.Service.info(l.dir, l.fromOrder).off);
    if (allOff) {
      P.data = new Map();
      P.plan.legs.forEach((l) => P.data.set(l.dir.id, { vehicles: [], err: '', at: Date.now(), loading: false }));
      P.req++;
      render(true);
      return;
    }
    const rid = ++P.req;
    P.plan.legs.forEach((leg) => {
      const old = P.data.get(leg.dir.id) || {};
      P.data.set(leg.dir.id, { vehicles: old.vehicles || [], err: '', at: old.at || 0, loading: !old.at });
    });
    render(true);
    await ZJ.batch(P.plan.legs, 3, async (leg) => {
      try {
        const data = await ZJ.Api.vehicles(leg.dir.id);
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: ZJ.RT.normalize(leg.dir, data), err: '', at: Date.now(), loading: false });
      } catch (e) {
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: [], err: (e && e.message) || '网络异常', at: Date.now(), loading: false });
      }
    });
    if (rid !== P.req) return;
    render(true);
  }

  function startPoll() {
    stopPoll();
    P.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && $('page-plan').classList.contains('on')) loadAll();
    }, ZJ.CFG.LINE_POLL);
  }
  function stopPoll() {
    if (P.timer) clearInterval(P.timer);
    P.timer = null;
  }

  const Plan = {
    open(plan, from, to) {
      if (!plan || !plan.legs || !plan.legs.length) { ZJ.toast('方案信息不完整'); return; }
      P.plan = plan;
      P.from = from || plan.legs[0].from;
      P.to = to || plan.legs[plan.legs.length - 1].to;
      P.data = new Map();
      P.req++;
      $('plTitle').textContent = '出行方案';
      $('plSub').textContent = P.from + ' → ' + P.to + ' · ' + (plan.transfers === 0 ? '直达' : plan.transfers + ' 次换乘');
      $('plSummary').innerHTML = '';
      $('plLegs').innerHTML = '<div class="pl-loading"><span class="spin"></span>正在获取分段实时公交…</div>';
      ZJ.UI.openFull('page-plan');
      render();
      loadAll();
      startPoll();
    },
    close() {
      stopPoll();
      P.req++;
      ZJ.UI.closeFull('page-plan');
    },
    refresh() { ZJ.Api.resetHealth(); loadAll(); },
    state() { return P; }
  };
  ZJ.Plan = Plan;

  /* ---------------- 动作 ---------------- */
  ZJ.act('plan-back', () => Plan.close());
  ZJ.act('plan-refresh', () => { ZJ.Api.resetHealth(); loadAll(); ZJ.toast('正在重新获取实时数据…'); });
  ZJ.act('pl-line', (el) => {
    ZJ.Line.open(el.dataset.line, el.dataset.dir, el.dataset.station);
  });
  ZJ.act('pl-bell', (el) => {
    ZJ.Reminder.openSheet({ line: el.dataset.line, dirKey: el.dataset.dir, station: el.dataset.station }, () => {
      render(true);
      if (ZJ.Home) ZJ.Home.renderReminders();
    });
  });
  /* 点顶部高亮条 → 滚到对应乘车段 */
  ZJ.act('pl-hl', (el) => {
    const i = Number(el.dataset.idx) || 0;
    const card = document.querySelectorAll('#plLegs .pl-leg')[i];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
