// 线上部署校验：加载 GitHub Pages，检查资源、Tab、实时页与报错
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://0124577.github.io/zhuji-bus-easy/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' ' + r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url() + ' HTTP ' + r.status()); });

const out = [];
const ok = (n, c, extra = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

ok('页面标题', (await page.title()).includes('诸暨'), await page.title());

const stat = await page.evaluate(() => ({
  hasZJ: typeof window.ZJ === 'object',
  lines: (window.ZJ?.Data?.lines || []).length,
  dirs: [...(window.ZJ?.Data?.dirs?.keys?.() || [])].length,
  stations: (window.ZJ?.Data?.stations || []).length,
  tabs: [...document.querySelectorAll('.tabbar .tab')].map((e) => e.textContent.trim()),
  apiMode: window.ZJ?.Api?.mode,
  mapRefs: /amap|AMap|BMap|mapbox|leaflet|qq\.map/i.test(document.documentElement.outerHTML),
}));
ok('运行环境存在 ZJ', stat.hasZJ);
ok('静态数据加载', stat.lines > 300 && stat.stations > 2000, `${stat.lines} 线/${stat.dirs} 向/${stat.stations} 站`);
ok('Tab 为 首页/出行/设置', stat.tabs.join('/') === '首页/出行/设置', stat.tabs.join(' | '));
ok('无地图 SDK 引用', !stat.mapRefs);

// 切到「出行」
await page.evaluate(() => window.ZJ.setTab('go'));
await new Promise((r) => setTimeout(r, 400));
const goState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-go')?.classList.contains('on'),
  title: document.querySelector('#page-go h1')?.textContent.trim(),
  queryBtn: !!document.querySelector('[data-act="plan"]')
}));
ok('切到「出行」', goState.on && goState.title === '出行', JSON.stringify(goState));

// 设置页：主题 / 开关 / 轮询 / 权限状态
await page.evaluate(() => window.ZJ.setTab('settings'));
await new Promise((r) => setTimeout(r, 700));
const setState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-settings')?.classList.contains('on'),
  themes: document.querySelectorAll('.theme-dot').length,
  switches: document.querySelectorAll('.switch').length,
  poll: document.querySelectorAll('#pollSeg .seg-b').length,
  perm: (document.getElementById('permBadge') || {}).textContent,
  ver: (document.getElementById('verTxt') || {}).textContent
}));
ok('设置页可打开且项目齐全', setState.on && setState.themes === 4 && setState.switches === 2 && setState.poll === 4, JSON.stringify(setState));
ok('设置页展示通知权限状态', ['已开启', '未开启', '已关闭', '不支持'].indexOf(setState.perm) > -1, setState.perm);
await page.evaluate(() => window.ZJ.setTab('home'));
await new Promise((r) => setTimeout(r, 300));

// 打开一条线路（静态数据第一条）
const lineName = await page.evaluate(() => {
  window.ZJ.setTab('home');
  const ln = window.ZJ.Data.lines[0];
  window.ZJ.Line.open(ln.name);
  return ln.name;
});
await new Promise((r) => setTimeout(r, 2500));
const lineState = await page.evaluate(() => {
  const scroll = document.querySelector('#tlScroll');
  return {
    open: document.querySelector('#page-line')?.classList.contains('on'),
    name: document.querySelector('.line-title')?.textContent?.trim(),
    vtRows: document.querySelectorAll('.vt-row').length,
    tlNodes: document.querySelectorAll('.tl-item').length,
    hScroll: scroll ? getComputedStyle(scroll).overflowX : '',
    scrollable: scroll ? scroll.scrollWidth > scroll.clientWidth : false,
    mode: document.querySelector('.data-mode')?.textContent?.trim() || window.ZJ.Api.mode,
    nearby: document.querySelectorAll('#nearbyCard,.nb-row').length,
  };
});
ok('线路详情打开', !!lineState.open && lineState.vtRows > 3, `${lineName} / 竖向 ${lineState.vtRows} 行 / ${lineState.mode}`);
ok('横向时间轴可左右滚动', lineState.hScroll === 'auto' && lineState.scrollable, `${lineState.tlNodes} 节点`);
ok('首页已无附近站点栏目', lineState.nearby === 0);

// 确认线上已部署「还要 N 站」高亮条版本
const deploy = await page.evaluate(async () => {
  const txt = async (u) => (await fetch(u, { cache: 'no-store' })).text();
  const [js, css, go, settings, theme, core] = await Promise.all([
    txt('js/plan.js'), txt('css/app.css'), txt('js/go.js'), txt('js/settings.js'), txt('css/theme.css'), txt('js/core.js')
  ]);
  return {
    js: js.indexOf('到目的地还有') > -1,
    css: css.indexOf('.pl-hl') > -1,
    hero: go.indexOf('plan-hero') > -1,
    settings: settings.length > 500,
    theme: theme.indexOf('data-theme="sky"') > -1,
    service: core.indexOf('ZJ.Service') > -1 && core.indexOf('lastBoard') > -1,
    multi: go.indexOf('plan-metrics') > -1 && go.indexOf('walk-card') > -1,
    walkCss: theme.indexOf('.walk-card') > -1
  };
});
ok('线上已部署方案详情大字条（JS）', deploy.js);
ok('线上已部署方案详情大字条（CSS）', deploy.css);
ok('线上已部署出行页「到目的地还有 N 站」', deploy.hero);
ok('线上已部署设置页脚本', deploy.settings);
ok('线上已部署主题色切换', deploy.theme);
ok('线上已部署首末班校验模块', deploy.service);
ok('线上已部署多方案卡片与步行提示', deploy.multi && deploy.walkCss, JSON.stringify({ multi: deploy.multi, css: deploy.walkCss }));

/* ---- v1.4.0：首末班校验 + 多方案卡片 ---- */
const svc = await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('1路').dirs[0];
  ZJ.Clock.setFixed(9 * 60);
  const open = ZJ.Service.info(dir, 1);
  ZJ.Clock.setFixed(23 * 60 + 30);
  const closed = ZJ.Service.info(dir, 1);
  return { openState: open.state, closedState: closed.state, off: closed.off, first: dir.first, last: dir.last };
});
ok('首末班判定：运营时段内为运营中', svc.openState === 'running' || svc.openState === 'lastGone', JSON.stringify(svc));
ok('首末班判定：超过末班后判为已收班', svc.closedState === 'closed' && svc.off, JSON.stringify(svc));

const lineClosed = await page.evaluate(() => {
  ZJ.Clock.setFixed(23 * 60 + 30);
  ZJ.Line.open('1路');
  return true;
});
await new Promise((r) => setTimeout(r, 2200));
const lc = await page.evaluate(() => ({
  stat: (document.getElementById('lineStat') || {}).innerText.replace(/\s+/g, ' ').trim(),
  tag: (document.querySelector('#lineInfo .tag') || {}).textContent.trim(),
}));
ok('线上收班后线路页显示已收班', /已收班/.test(lc.stat) && lc.tag === '已收班', JSON.stringify(lc).slice(0, 110));
ok('线上收班后不显示剩余站数与到达时间', !/\d+\s*站\s*·\s*\d+\s*分/.test(lc.stat) && !/约\s*\d+\s*分钟/.test(lc.stat), lc.stat.slice(0, 70));
await page.evaluate(() => ZJ.Line.close());
await new Promise((r) => setTimeout(r, 500));

/* 出行页：09:00 多方案 */
await page.evaluate(() => { ZJ.Clock.setFixed(9 * 60); ZJ.setTab('go'); });
await new Promise((r) => setTimeout(r, 400));
const pick = async (act, name) => {
  await page.evaluate((a) => document.querySelector('[data-act="' + a + '"]').click(), act);
  await new Promise((r) => setTimeout(r, 350));
  await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
  await new Promise((r) => setTimeout(r, 200));
  await page.type('#pkQ', name);
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await new Promise((r) => setTimeout(r, 500));
};
await pick('pick-from', '火车站');
await pick('pick-to', '草塔停车场');
await new Promise((r) => setTimeout(r, 2600));
const multi = await page.evaluate(() => ({
  cards: document.querySelectorAll('#planResult .plan-card').length,
  tabs: document.querySelectorAll('.plan-tab').length,
  metrics: document.querySelectorAll('#planResult .plan-card.sel .pm').length,
  strips: document.querySelectorAll('#planResult .tl-item').length,
  hero: (document.querySelector('#planResult .plan-hero') || {}).innerText || '',
}));
ok('线上出行页输出多套方案卡片', multi.cards >= 2 && multi.tabs >= 2, JSON.stringify(multi).slice(0, 90));
ok('线上方案卡展示四项核心指标', multi.metrics === 4, String(multi.metrics));
ok('线上方案卡复用站点时间轴', multi.strips > 5, String(multi.strips));
ok('线上正常时段展示剩余站数', /到目的地还有\s*\d+\s*站/.test(multi.hero), multi.hero.replace(/\s+/g, ' ').trim());

const goClosed = await page.evaluate(() => {
  ZJ.Clock.setFixed(23 * 60 + 30);
  ZJ.Go.tick();
  const res = document.getElementById('planResult');
  const cards = [...res.querySelectorAll('.plan-card')];
  return {
    off: cards.filter((c) => c.classList.contains('off')).length,
    remain: /到目的地还有\s*\d+\s*站/.test(res.innerText),
    eta: /\d+:\d+\s*到达/.test(res.innerText),
    banner: (res.querySelector('.degrade-banner') || {}).innerText || '',
  };
});
ok('线上收班后整卡标记已收班', goClosed.off > 0, String(goClosed.off));
ok('线上收班后不再渲染剩余站数', !goClosed.remain);
ok('线上收班后不再渲染到达时间', !goClosed.eta);
ok('线上收班后提示今日末班已过', /今日末班已过/.test(goClosed.banner), goClosed.banner.replace(/\s+/g, ' ').slice(0, 40));

const shotDir = 'C:/work/bus/_tmp/shots';
await page.screenshot({ path: `${shotDir}/live-line.png` });
await page.evaluate(() => window.ZJ.Line.close());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${shotDir}/live-home.png` });

ok('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' || '));
ok('无失败请求', failed.length === 0, failed.slice(0, 3).join(' || '));

console.log(out.join('\n'));
const fails = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n合计 ${out.length} 项，失败 ${fails} 项`);
await browser.close();
process.exit(fails ? 1 : 0);
