/* 首页：线路搜索 / 收藏 / 全部线路 / 提醒概览（已移除附近站点栏目） */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;

  const H = { q: '', limit: 80, timer: null };

  function renderFav() {
    const lines = ZJ.Fav.lines();
    const sts = ZJ.Fav.stations();
    const card = $('favCard');
    /* 没有收藏时整块隐藏，首页更清爽 */
    card.hidden = !lines.length && !sts.length;
    $('favCount').textContent = lines.length + sts.length ? lines.length + ' 线路 · ' + sts.length + ' 站点' : '';
    if (!lines.length && !sts.length) { $('favBody').innerHTML = ''; return; }
    let html = '';
    if (lines.length) {
      html += '<div class="fav-group"><div class="fav-lab">收藏线路</div><div class="chips">' +
        lines.map((n) => '<button class="chip-line" data-act="open-line" data-name="' + ZJ.esc(n) + '">' + ZJ.esc(n) + '</button>').join('') +
        '</div></div>';
    }
    if (sts.length) {
      html += '<div class="fav-group"><div class="fav-lab">收藏站点</div>' +
        sts.map((n) => '<button class="fav-st" data-act="open-station" data-name="' + ZJ.esc(n) + '">' +
          '<svg class="ico ico-star"><use href="#i-star"/></svg><b>' + ZJ.esc(n) + '</b>' +
          '<svg class="ico"><use href="#i-right"/></svg></button>').join('') + '</div>';
    }
    $('favBody').innerHTML = html;
  }

  function renderReminders() {
    const list = ZJ.Reminder.list();
    const card = $('remindCard');
    card.hidden = !list.length;
    if (!list.length) return;
    $('remindBody').innerHTML = list.slice(0, 3).map((r) => {
      let status = '等待实时数据';
      let cls = '';
      if (r.done) { status = '已提醒 ' + ZJ.clock(new Date(r.doneAt || Date.now())).slice(0, 5); }
      else if (r.state === 'tracking' && r.remain != null) {
        status = r.remain === 0 ? '车辆已到站' : '还有 ' + r.remain + ' 站 · 约 ' + r.minutes + ' 分';
        cls = 'remind-live';
      } else if (r.state === 'error') { status = '实时数据中断'; }
      else if (r.state === 'closed') { status = '线路已收班 · 明早恢复'; }
      else if (r.state === 'idle') { status = '当前无在线车辆'; }
      else if (r.state === 'passed') { status = '车辆已过站'; }
      return '<div class="remind-row"><span class="remind-badge">' + ZJ.esc(r.line) + '</span>' +
        '<span class="remind-main"><b>' + ZJ.esc(r.station) + '</b><br>' +
        '<span class="' + cls + '" style="font-size:11px">' + ZJ.esc(status) + '</span></span>' +
        '<button class="remind-x" data-act="remind-del" data-id="' + r.id + '"><svg class="ico"><use href="#i-close"/></svg></button></div>';
    }).join('') + (list.length > 3 ? '<div class="mini-txt" style="padding:8px 2px 0">还有 ' + (list.length - 3) + ' 条，点「管理」查看</div>' : '');
  }

  function renderLines() {
    const q = H.q.trim();
    const all = Data.searchLines(q, 0);
    $('lineTitle').textContent = q ? '搜索结果' : '全部线路';
    $('lineCount').textContent = q ? all.length + ' 条匹配' : '共 ' + Data.lines.length + ' 条';
    if (!all.length) {
      $('lineList').innerHTML = '<div class="empty-block">没有找到「' + ZJ.esc(q) + '」相关线路<br>试试只输入数字，如 1、23、105</div>';
      return;
    }
    const list = all.slice(0, H.limit);
    $('lineList').innerHTML = list.map((l) => {
      const d = l.dirs[0];
      const fav = ZJ.Fav.hasLine(l.name);
      return '<div class="line-row" data-act="open-line" data-name="' + ZJ.esc(l.name) + '">' +
        '<span class="line-badge">' + ZJ.esc(l.name) + '</span>' +
        '<span class="line-main"><b>' + ZJ.esc(d.start) + ' → ' + ZJ.esc(d.end) + '</b>' +
        '<span>' + d.stops.length + ' 站 · 首 ' + ZJ.esc(d.first) + ' · 末 ' + ZJ.esc(d.last) + '</span></span>' +
        '<button class="line-star ' + (fav ? 'on' : '') + '" data-act="fav-line" data-name="' + ZJ.esc(l.name) + '">' +
        '<svg class="ico"><use href="#i-star"/></svg></button></div>';
    }).join('') +
      (all.length > list.length ? '<div class="empty-block" style="padding:16px"><button class="btn-ghost" data-act="more-lines">加载更多线路（还有 ' + (all.length - list.length) + ' 条）</button></div>' : '');
  }

  function openReminderList(updateOnly) {
    const list = ZJ.Reminder.list();
    if (!list.length) {
      const html = '<div class="sheet-h"><b>到站提醒</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
        '<div class="sheet-body"><div class="pick-empty">还没有设置提醒<br>在线路详情页点「到站提醒」即可添加<br>仅在 App 内弹窗 + 震动，不发送推送</div></div>';
      if (updateOnly) ZJ.UI.updateSheet(html); else ZJ.UI.sheet(html);
      return;
    }
    const html = '<div class="sheet-h"><b>到站提醒</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body"><div class="rm-list">' +
      list.map((r) => {
        const mode = ZJ.Reminder.MODES[r.mode] || ZJ.Reminder.MODES.arrive;
        let st = mode.label;
        if (r.done) st = '已提醒 · ' + ZJ.clock(new Date(r.doneAt || Date.now())).slice(0, 5);
        else if (r.state === 'tracking' && r.remain != null) st = mode.label + ' · 还有 ' + r.remain + ' 站';
        else if (r.state === 'error') st = mode.label + ' · 数据中断';
        else if (r.state === 'closed') st = mode.label + ' · 线路已收班';
        return '<div class="rm-item"><span class="r-badge">' + ZJ.esc(r.line) + '</span>' +
          '<div class="r-body"><b>' + ZJ.esc(r.station) + ' · ' + (r.dirKey === 'up' ? '上行' : '下行') + '</b><span>' + ZJ.esc(st) + '</span></div>' +
          '<button class="r-del" data-act="remind-del" data-id="' + r.id + '"><svg class="ico"><use href="#i-trash"/></svg></button></div>';
      }).join('') +
      '</div><button class="mini" style="width:100%;margin-top:12px;height:38px" data-act="remind-clear">清空全部提醒</button>' +
      '<p class="sheet-note">提醒依赖实时接口，App 关闭或接口中断时不会触发，也不会发送系统推送。</p></div>';
    if (updateOnly) ZJ.UI.updateSheet(html); else ZJ.UI.sheet(html);
  }

  const Home = {
    renderFav: renderFav,
    renderReminders: renderReminders,
    renderLines: renderLines,
    renderAll() {
      renderFav();
      renderReminders();
      renderLines();
    }
  };
  ZJ.Home = Home;

  /* 搜索 */
  function onSearch() {
    const input = $('lineQ');
    H.q = input.value;
    H.limit = 80;
    $('lineQClear').hidden = !H.q;
    clearTimeout(H.timer);
    H.timer = setTimeout(renderLines, 90);
  }

  /* ---------- 动作 ---------- */
  ZJ.act('open-line', (el) => ZJ.Line.open(el.dataset.name));
  ZJ.act('open-station', (el) => ZJ.Station.open(el.dataset.name));
  ZJ.act('fav-line', (el, e) => {
    if (e) e.stopPropagation();
    const on = ZJ.Fav.toggleLine(el.dataset.name);
    el.classList.toggle('on', on);
    ZJ.toast(on ? '已收藏 ' + el.dataset.name : '已取消收藏');
    renderFav();
  });
  ZJ.act('more-lines', () => { H.limit += 80; renderLines(); });
  ZJ.act('clear-q', () => {
    $('lineQ').value = '';
    onSearch();
    $('lineQ').focus();
  });
  ZJ.act('reminder-list', () => openReminderList());
  ZJ.act('remind-del', (el, e) => {
    if (e) e.stopPropagation();
    ZJ.Reminder.remove(el.dataset.id);
    renderReminders();
    if (ZJ.UI.isSheetOpen()) openReminderList(true);
    ZJ.toast('已删除提醒');
  });
  ZJ.act('remind-clear', () => {
    ZJ.Reminder.clear();
    ZJ.UI.closeSheet();
    renderReminders();
    ZJ.toast('已清空全部提醒');
  });

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    const input = $('lineQ');
    input.addEventListener('input', onSearch);
    input.addEventListener('search', onSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); onSearch(); }
      if (e.key === 'Escape') { input.value = ''; onSearch(); }
    });
    ZJ.Reminder.onChange(() => {
      renderReminders();
      if (ZJ.Line && ZJ.Line.state && ZJ.Line.state().line) {
        /* 线路页的提醒状态由其自身重绘 */
      }
    });
  }

  window.addEventListener('DOMContentLoaded', bind);
  if (document.readyState !== 'loading') bind();
})();
