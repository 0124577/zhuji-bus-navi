/* 本地到站提醒：只在 App 内弹窗 + 震动，不做推送、不做后台订阅 */
(function () {
  const ZJ = window.ZJ;
  const KEY = 'zjbus.reminders.v1';
  const MODES = {
    arrive: { label: '到站提醒', desc: '车辆到达所选站点时提醒', threshold: 0 },
    one: { label: '下一站提醒', desc: '车辆距站点还有 1 站时提醒', threshold: 1 },
    two: { label: '提前 2 站', desc: '车辆距站点还有 2 站时提醒（可选）', threshold: 2 }
  };

  let items = ZJ.Store.get(KEY, []);
  let timer = null;
  let ticking = false;
  let onChange = null;

  function save() { ZJ.Store.set(KEY, items); }
  function emit() { if (typeof onChange === 'function') onChange(items); }

  const Reminder = {
    MODES: MODES,
    list() { return items.slice(); },
    active() { return items.filter((r) => !r.done); },
    count() { return items.filter((r) => !r.done).length; },
    onChange(fn) { onChange = fn; },
    find(line, dirKey, station) {
      return items.find((r) => r.line === line && r.dirKey === dirKey && r.station === station && !r.done);
    },
    add(opt) {
      const line = opt.line, dirKey = opt.dirKey, station = opt.station, mode = MODES[opt.mode] ? opt.mode : 'arrive';
      const dir = ZJ.Data.lineOf(line) && ZJ.Data.lineOf(line).dirs.find((d) => d.key === dirKey);
      if (!dir) { ZJ.toast('线路信息缺失，无法设置提醒'); return null; }
      const old = Reminder.find(line, dirKey, station);
      if (old) {
        old.mode = mode;
        old.created = Date.now();
        old.done = false;
        old.state = 'pending';
        save(); emit();
        return old;
      }
      if (Reminder.count() >= 10) { ZJ.toast('最多同时设置 10 条提醒'); return null; }
      const rm = {
        id: 'rm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        line: line,
        dirKey: dirKey,
        dirId: dir.id,
        station: station,
        mode: mode,
        created: Date.now(),
        done: false,
        state: 'pending',
        remain: null,
        minutes: null,
        checkedAt: 0,
        error: ''
      };
      items.unshift(rm);
      save(); emit();
      Reminder.tick();
      return rm;
    },
    remove(id) {
      items = items.filter((r) => r.id !== id);
      save(); emit();
    },
    clear() {
      items = [];
      save(); emit();
    },
    /* 轮询一次：按方向合并请求，避免重复调用 */
    async tick() {
      if (ticking) return;
      if (document.visibilityState === 'hidden') return;
      if (ZJ.Api.mode === 'static') return;
      let changed = false;
      const act = Reminder.active().filter((r) => {
        const dir = ZJ.Data.dirs.get(r.dirId);
        const target = dir && dir.stops.find((s) => s.name === r.station);
        if (!target) return true;
        /* 已收班 / 首班前：不请求接口，直接标记收班，避免展示过期的剩余站数 */
        if (ZJ.Service.info(dir, target.o).off) {
          if (r.state !== 'closed') changed = true;
          r.state = 'closed';
          r.remain = null;
          r.minutes = null;
          return false;
        }
        return true;
      });
      if (!act.length) { if (changed) emit(); return; }
      ticking = true;
      try {
        const byDir = new Map();
        act.forEach((r) => {
          if (!byDir.has(r.dirId)) byDir.set(r.dirId, []);
          byDir.get(r.dirId).push(r);
        });
        const ids = [...byDir.keys()];
        await ZJ.batch(ids, 3, async (dirId) => {
          let data = null;
          try {
            data = await ZJ.Api.vehicles(dirId);
          } catch (e) {
            byDir.get(dirId).forEach((r) => {
              r.state = 'error';
              r.error = e.message || '网络异常';
              r.checkedAt = Date.now();
            });
            return;
          }
          const dir = ZJ.Data.dirs.get(dirId);
          if (!dir) return;
          const list = ZJ.RT.normalize(dir, data);
          byDir.get(dirId).forEach((r) => {
            r.checkedAt = Date.now();
            r.error = '';
            const target = dir.stops.find((s) => s.name === r.station);
            if (!target) { r.state = 'error'; r.error = '站点不在该线路'; return; }
            /* 首末班校验：收班 / 首班前不再盯着剩余站数，也不会触发提醒 */
            const svc = ZJ.Service.info(dir, target.o);
            if (svc.off) {
              r.state = 'closed';
              r.remain = null;
              r.minutes = null;
              r.error = '';
              return;
            }
            const arr = ZJ.RT.arrivalsTo(dir, list, target.o);
            const nearest = arr[0];
            if (!nearest) {
              r.state = list.length ? 'passed' : 'idle';
              r.remain = null;
              r.minutes = null;
              if (list.length && data.startTime) r.nextStart = data.startTime;
              return;
            }
            r.remain = nearest.remain;
            r.minutes = nearest.minutes;
            r.plate = nearest.v.plate;
            r.state = 'tracking';
            const th = MODES[r.mode].threshold;
            if (nearest.remain <= th) {
              r.done = true;
              r.doneAt = Date.now();
              r.state = 'done';
              save();
              Reminder.fire(r, nearest, dir);
            }
          });
        });
        /* 清理 2 小时前的已完成提醒 */
        const now = Date.now();
        const before = items.length;
        items = items.filter((r) => !(r.done && now - (r.doneAt || r.created) > 7200 * 1000));
        if (items.length !== before) save();
        emit();
      } finally {
        ticking = false;
      }
    },
    fire(rm, info, dir) {
      const isArrive = rm.mode === 'arrive';
      const title = isArrive ? '车辆已到站' : '车辆即将到站';
      const sub = isArrive
        ? (info.v.plate || '车辆') + ' 已到达「' + rm.station + '」，请准备下车'
        : (info.v.plate || '车辆') + ' 距「' + rm.station + '」还有 ' + info.remain + ' 站 · 约 ' + info.minutes + ' 分钟';
      const html =
        '<div class="alert-bell"><svg class="ico"><use href="#i-bell"/></svg></div>' +
        '<h3>' + ZJ.esc(title) + '</h3>' +
        '<p class="a-sub">' + ZJ.esc(sub) + '</p>' +
        '<div class="a-line"><svg class="ico"><use href="#i-bus"/></svg>' + ZJ.esc(rm.line) + ' · ' + ZJ.esc(dir.end) + ' 方向</div>' +
        '<div class="alert-btns"><button class="ghost" id="rmGo">知道了</button><button class="primary" id="rmView">查看线路</button></div>';
      ZJ.UI.alert(html);
      /* 响铃 + 震动 + 系统通知（都按设置开关执行） */
      ZJ.Sound.chime();
      ZJ.UI.vibrate([400, 150, 400, 150, 700]);
      ZJ.Notify.fire(title, sub).catch(() => {});
      const $ = ZJ.$;
      const go = $('rmGo'), view = $('rmView');
      if (go) go.addEventListener('click', () => ZJ.UI.closeAlert());
      if (view) view.addEventListener('click', () => {
        ZJ.UI.closeAlert();
        if (ZJ.Line && ZJ.Line.open) ZJ.Line.open(rm.line, rm.dirKey, rm.station);
      });
      emit();
    },
    start() {
      Reminder.stop();
      const sec = Math.max(5, Math.min(60, Number(ZJ.Prefs ? ZJ.Prefs.get('poll') : 15) || 15));
      timer = setInterval(() => Reminder.tick(), sec * 1000);
      Reminder.tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };

  /* ================= 提醒设置弹层（线路页 / 方案详情页共用） ================= */
  let uiTarget = null;
  let uiMode = 'one';
  let uiDone = null;

  function dirEndOf(target) {
    const line = ZJ.Data.lineOf(target.line);
    const dir = line && line.dirs.find((d) => d.key === target.dirKey);
    return dir ? dir.end : '';
  }

  function sheetHtml(target, rm) {
    const modes = Object.keys(MODES).map((k) => {
      const m = MODES[k];
      return '<button class="rm-mode ' + (k === uiMode ? 'on' : '') + '" data-act="rm-mode" data-mode="' + k + '">' +
        '<span class="r-ico"><svg class="ico"><use href="#i-bell"/></svg></span>' +
        '<span class="r-t"><b>' + m.label + '</b><span>' + m.desc + '</span></span>' +
        '<span class="r-chk"></span></button>';
    }).join('');
    const end = dirEndOf(target);
    return '<div class="sheet-h"><b>到站提醒</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body">' +
      '<div class="st-summary" style="margin-bottom:12px"><b>' + ZJ.esc(target.line) + '</b>' +
      (end ? '<span>往 ' + ZJ.esc(end) + '</span>' : '') +
      '<span class="upd">' + ZJ.esc(target.station) + '</span></div>' +
      '<div class="rm-modes">' + modes + '</div>' +
      '<p class="sheet-note">到站时会弹窗、响铃并震动；开启通知权限后，锁屏或切到后台也能收到。实时数据中断时提醒会暂停。</p>' +
      '<button class="sheet-primary" data-act="rm-save">' + (rm ? '更新提醒方式' : '开启提醒') + '</button>' +
      (rm ? '<button class="mini" style="width:100%;margin-top:10px;height:38px" data-act="rm-cancel">关闭该站提醒</button>' : '') +
      '</div>';
  }

  /* target: { line, dirKey, station }；onDone: 设置变化后的回调 */
  Reminder.openSheet = function (target, onDone) {
    uiTarget = target;
    uiDone = typeof onDone === 'function' ? onDone : null;
    const rm = Reminder.find(target.line, target.dirKey, target.station);
    uiMode = rm ? rm.mode : 'one';
    ZJ.UI.sheet(sheetHtml(target, rm));
  };

  ZJ.act('rm-mode', (el) => {
    uiMode = MODES[el.dataset.mode] ? el.dataset.mode : 'one';
    const wrap = el.parentNode;
    if (wrap) wrap.querySelectorAll('.rm-mode').forEach((n) => n.classList.toggle('on', n === el));
  });
  ZJ.act('rm-save', () => {
    if (!uiTarget) return;
    const rm = Reminder.add({ line: uiTarget.line, dirKey: uiTarget.dirKey, station: uiTarget.station, mode: uiMode });
    ZJ.UI.closeSheet();
    if (rm) ZJ.toast('已开启：' + MODES[rm.mode].label);
    if (uiDone) uiDone();
    /* 没有通知权限时，明确告诉用户锁屏收不到 */
    if (rm && ZJ.Settings && ZJ.Settings.promptPermIfNeeded) {
      setTimeout(() => ZJ.Settings.promptPermIfNeeded(), 420);
    }
  });
  ZJ.act('rm-cancel', () => {
    if (!uiTarget) return;
    const rm = Reminder.find(uiTarget.line, uiTarget.dirKey, uiTarget.station);
    if (rm) Reminder.remove(rm.id);
    ZJ.UI.closeSheet();
    ZJ.toast('已关闭该站提醒');
    if (uiDone) uiDone();
  });

  ZJ.Reminder = Reminder;
})();
