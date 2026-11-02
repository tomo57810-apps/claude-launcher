// ランチャー: 好きなフォルダー・ファイルを、グループ(タブ)に分けて登録しておき、ワンクリック(タップ)で開く。
// 呼び出し: パソコン=Esc を2回 / 携帯=何もない所を2回タップ / 「🚀 ランチャー」ボタン。explorer.js から Launcher.init(...) で使う。
// 登録の保存先は、サーバーの launcher.json(お気に入りと同じ仕組み。全端末で共有、変更は即時に反映)。フォルダーは、末尾に「/」を付けた形で保存する。
(() => {
'use strict';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const h = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html !== undefined) e.innerHTML = html; return e; };
const clone = o => JSON.parse(JSON.stringify(o));
const newGid = () => 'g' + Math.random().toString(36).slice(2, 8);
const isDirKey = p => p.endsWith('/');
const keyOf = (path, isDir) => (isDir && !path.endsWith('/') ? path + '/' : path);
const plain = p => (p.length > 1 ? p.replace(/\/+$/, '') : p);

let installEvt = null; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; }); // ランチャー専用ページ(launcher.html)で、アプリとして追加できるとき
if (location.pathname === '/launcher/' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/launcher/sw.js', { scope: '/launcher/' }).catch(() => {}); // 専用アプリとして入れられる条件(サービスワーカー)
let ctx = null, el = null, tabsEl = null, gridEl = null, titleEl = null, shown = false, drag = null;
let D = { rev: 0, items: [], groups: [] };
let curGid = lsGet('fb_laugid', '');
const curGroup = () => D.groups.find(g => g.id === curGid) || D.groups[0] || null;
const allKeys = () => D.groups.flatMap(g => g.items);

/* ---------- 窓の状態(端末ごとに記憶): 配置・大きさ・位置・固定・表示 ---------- */
// mode: float=浮かせる(自由な位置・大きさ) / dock-r・dock-l・dock-b=右・左・下に固定して画面を分割 / fill=別ウィンドウ(ポップアップ)の中で全面
let popup = new URLSearchParams(location.search).get('lpopup') === '1';
const MODES = ['float', 'dock-r', 'dock-l', 'dock-b'];
const STANDALONE = !!window.__LAUNCHER_STANDALONE; // 別アプリ(github.io の専用ページ)として動いているとき: 窓ではなく、画面いっぱいに出し続ける
let mode = (popup || STANDALONE) ? 'fill' : (MODES.includes(lsGet('fb_lau_mode', 'float')) ? lsGet('fb_lau_mode', 'float') : 'float');
let pin = lsGet('fb_lau_pin', '1') !== '0'; // 既定: 固定(フォルダー・ファイルを選んでも閉じない)
let view = ['s', 'm', 'l', 'list'].includes(lsGet('fb_lau_view', 'm')) ? lsGet('fb_lau_view', 'm') : 'm';
const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k, '')); return v && typeof v === 'object' ? v : d; } catch { return d; } };
let geo = lsJson('fb_lau_geo', null); // 浮かせているときの {x,y,w,h}。無ければ既定(右下)
const DOCK0 = { r: 360, l: 360, b: 300 };
let dock = { ...DOCK0, ...lsJson('fb_lau_dock', {}) };
let card = null;
const MINW = 240, MINH = 180;
const VW = () => document.documentElement.clientWidth || innerWidth, VH = () => document.documentElement.clientHeight || innerHeight;
const defGeo = () => { const w = Math.round(Math.min(VW() * .94, 560)), h = Math.round(Math.min(VH() * .72, 560)); return { w, h, x: VW() - w - 10, y: VH() - h - 10 }; };
const fit = g => { const w = clamp(Math.round(+g.w || 0), Math.min(MINW, VW()), VW()), h = clamp(Math.round(+g.h || 0), Math.min(MINH, VH()), VH()); return { w, h, x: clamp(Math.round(+g.x || 0), 0, VW() - w), y: clamp(Math.round(+g.y || 0), 0, VH() - h) }; };
const curGeo = () => fit(geo || defGeo());
const dockMax = m => (m === 'b' ? VH() - 120 : VW() - 120), dockMin = m => (m === 'b' ? 140 : 200);
const saveState = () => { lsSet('fb_lau_mode', mode === 'fill' ? 'float' : mode); lsSet('fb_lau_pin', pin ? '1' : '0'); lsSet('fb_lau_view', view); lsSet('fb_lau_geo', geo ? JSON.stringify(geo) : ''); lsSet('fb_lau_dock', JSON.stringify(dock)); };
function layout() { // 窓の配置を、いまの状態に合わせる(閉じているときは、画面分割も解く)
  const root = document.documentElement;
  root.classList.remove('lau-dock-r', 'lau-dock-l', 'lau-dock-b'); root.style.removeProperty('--lau-d');
  root.classList.toggle('lau-popup', popup);
  if (!el) return;
  el.classList.toggle('unpin', shown && mode === 'float' && !pin);
  if (!card) return;
  card.className = 'lau-card v-' + view + ' m-' + mode + (STANDALONE ? ' standalone' : '');
  const s = card.style; s.left = s.top = s.right = s.bottom = s.width = s.height = '';
  if (!shown) return;
  if (mode === 'fill') { s.left = '0'; s.top = '0'; s.width = '100%'; s.height = '100%'; return; }
  if (mode === 'float') { const g = curGeo(); s.left = g.x + 'px'; s.top = g.y + 'px'; s.width = g.w + 'px'; s.height = g.h + 'px'; return; }
  const m = mode.slice(-1), d = clamp(dock[m] || DOCK0[m], dockMin(m), Math.max(dockMin(m), dockMax(m)));
  root.classList.add('lau-' + mode); root.style.setProperty('--lau-d', d + 'px');
  if (m === 'b') { s.left = '0'; s.right = '0'; s.bottom = '0'; s.height = d + 'px'; }
  else { s.top = '0'; s.bottom = '0'; s[m === 'r' ? 'right' : 'left'] = '0'; s.width = d + 'px'; }
}

const CSS = `
#lau{position:fixed;inset:0;z-index:135;pointer-events:none;-webkit-tap-highlight-color:transparent}
#lau[hidden]{display:none}
#lau.unpin{pointer-events:auto;background:rgba(0,0,0,.35)}
.lau-card{position:absolute;pointer-events:auto;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.38),0 0 0 1px rgba(0,0,0,.14);display:flex;flex-direction:column;overflow:hidden;font-size:14px;color:#1b1b1b;user-select:none;-webkit-user-select:none}
.lau-card.m-fill,.lau-card.m-dock-r,.lau-card.m-dock-l,.lau-card.m-dock-b{border-radius:0}
.lau-card.m-dock-r{border-left:2px solid #9bbfe8}.lau-card.m-dock-l{border-right:2px solid #9bbfe8}.lau-card.m-dock-b{border-top:2px solid #9bbfe8}
.lau-head{display:flex;align-items:center;gap:5px;padding:6px 8px 4px 10px;flex:none;cursor:move;touch-action:none}
.lau-card:not(.m-float) .lau-head{cursor:default}
.lau-title{font-weight:600;flex:1;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lau-head button{height:34px;min-width:34px;padding:0 8px;border:1px solid #d0d0d0;border-radius:8px;background:#f6f6f6;font:inherit;cursor:pointer}
.lau-card.m-fill .lau-lay,.lau-card.m-fill .lau-rst{display:none}
.lau-head button:hover{background:#e9eef7}
.lau-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:4px 10px 8px;max-height:122px;overflow-y:auto;flex:none;border-bottom:1px solid #e3e3e3}
.lau-tab{height:34px;max-width:46%;padding:0 12px;border:1px solid #d0d0d0;border-radius:17px;background:#f3f3f3;font:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;touch-action:pan-y}
.lau-tab.on{background:#0067c0;border-color:#0067c0;color:#fff}
.lau-tab.add{background:#fff;border-style:dashed;color:#0067c0;padding:0 14px}
.lau-grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--lt,104px),1fr));grid-auto-rows:var(--lt,104px);gap:8px;padding:10px;align-content:start;overscroll-behavior:contain}
.lau-tile{position:relative;border:1px solid #dcdfe4;border-radius:10px;background:#f7f9fc;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 6px 4px;cursor:pointer;overflow:hidden;touch-action:pan-y}
.lau-tile:hover{background:#e8f0fb;border-color:#9bbfe8}
.lau-tile .ic{font-size:32px;line-height:1}
.lau-tile .nm{font-size:12px;line-height:1.2;text-align:center;word-break:break-all;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;max-width:100%}
.lau-tile.miss{opacity:.45}
.lau-empty{grid-column:1/-1;color:#777;padding:30px 10px;text-align:center;line-height:1.7}
.lau-foot{flex:none;padding:5px 12px 8px;color:#888;font-size:11.5px;border-top:1px solid #eee;line-height:1.4}
.lau-src{opacity:.35}
.lau-ghost{position:fixed;z-index:420;pointer-events:none;opacity:.9;box-shadow:0 6px 18px rgba(0,0,0,.35);margin:0}
.lau-tile.ins-b{box-shadow:inset 4px 0 #ffb300}.lau-tile.ins-a{box-shadow:inset -4px 0 #ffb300}
.lau-tab.ins-b{box-shadow:inset 4px 0 #ffb300}.lau-tab.ins-a{box-shadow:inset -4px 0 #ffb300}
.lau-tab.hot{outline:3px solid #ffb300;outline-offset:1px}
.lau-card.v-s{--lt:76px}.lau-card.v-s .lau-tile .ic{font-size:24px}.lau-card.v-s .lau-tile .nm{font-size:11px}
.lau-card.v-m{--lt:104px}
.lau-card.v-l{--lt:144px}.lau-card.v-l .lau-tile .ic{font-size:46px}.lau-card.v-l .lau-tile .nm{font-size:14px}
.lau-card.v-list .lau-grid{grid-template-columns:1fr;grid-auto-rows:46px;gap:4px}
.lau-card.v-list .lau-tile{flex-direction:row;justify-content:flex-start;gap:10px;padding:4px 12px}
.lau-card.v-list .lau-tile .ic{font-size:24px}
.lau-card.v-list .lau-tile .nm{text-align:left;font-size:13px;-webkit-line-clamp:1}
.lau-rz{position:absolute;z-index:3;touch-action:none}
.lau-rz[data-d=n]{left:14px;right:14px;top:0;height:8px;cursor:ns-resize}.lau-rz[data-d=s]{left:14px;right:14px;bottom:0;height:8px;cursor:ns-resize}
.lau-rz[data-d=e]{top:14px;bottom:14px;right:0;width:8px;cursor:ew-resize}.lau-rz[data-d=w]{top:14px;bottom:14px;left:0;width:8px;cursor:ew-resize}
.lau-rz[data-d=ne]{top:0;right:0;width:16px;height:16px;cursor:nesw-resize}.lau-rz[data-d=sw]{bottom:0;left:0;width:16px;height:16px;cursor:nesw-resize}
.lau-rz[data-d=nw]{top:0;left:0;width:16px;height:16px;cursor:nwse-resize}.lau-rz[data-d=se]{bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize}
@media (pointer:coarse){.lau-rz[data-d=n],.lau-rz[data-d=s]{height:16px}.lau-rz[data-d=e],.lau-rz[data-d=w]{width:16px}.lau-rz[data-d=ne],.lau-rz[data-d=sw],.lau-rz[data-d=nw],.lau-rz[data-d=se]{width:28px;height:28px}}
.lau-card.m-fill .lau-rz{display:none}
.lau-card.m-dock-r .lau-rz:not([data-d=w]),.lau-card.m-dock-l .lau-rz:not([data-d=e]),.lau-card.m-dock-b .lau-rz:not([data-d=n]){display:none}
.lau-card.m-dock-r .lau-rz[data-d=w],.lau-card.m-dock-l .lau-rz[data-d=e]{top:0;bottom:0}.lau-card.m-dock-b .lau-rz[data-d=n]{left:0;right:0}
html.lau-dock-r #app{width:calc(100% - var(--lau-d))}html.lau-dock-l #app{width:calc(100% - var(--lau-d));margin-left:var(--lau-d)}html.lau-dock-b #app{height:calc(100% - var(--lau-d))}
html.lau-dock-r #pv{right:var(--lau-d)}html.lau-dock-l #pv{left:var(--lau-d)}html.lau-dock-b #pv{bottom:var(--lau-d)}
html.lau-popup #app{visibility:hidden}
.lau-card.standalone .lau-add{display:none}
.lau-min{display:none!important}
.lau-card.standalone .lau-min{display:inline-block!important}
.lau-card.standalone.min{height:auto!important;bottom:auto!important}
.lau-card.min .lau-tabs,.lau-card.min .lau-grid,.lau-card.min .lau-foot{display:none}
.lau-card.lau-drop{outline:3px dashed #0067c0;outline-offset:-3px}
`;

/* ---------- 保存(お気に入りと同じ。版番号で、他の端末との衝突を見つける) ---------- */
async function fetchDoc() { try { const r = await ctx.api('GET', '/api/launcher'); if (r.ok) { D = await r.json(); if (shown) render(); } } catch {} }
async function update(mut) {
  for (let t = 0; t < 4; t++) {
    const doc = clone(D); mut(doc); D = doc; if (shown) render(); // 先に画面へ反映する
    let r; try { r = await ctx.api('PUT', '/api/launcher', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }); } catch { break; }
    const j = await r.json().catch(() => null);
    if (r.ok) { D = j; if (shown) render(); return true; }
    if (r.status === 409 && j) { D = j; continue; } // 他の端末が先に変更した: 最新の内容の上でやり直す
    break;
  }
  ctx.toast('ランチャーを保存できませんでした'); await fetchDoc(); return false;
}
const grp = (d, gid) => d.groups.find(g => g.id === gid);
function rmKey(d, k) { d.groups.forEach(g => { g.items = g.items.filter(x => x !== k); }); d.items = d.items.filter(x => x !== k); }

/* ---------- 見た目 ---------- */
const iconOf = k => {
  if (isDirKey(k)) return '📁';
  const e = (k.split('.').pop() || '').toLowerCase();
  if (e === 'pdf') return '📕'; if (/^xls|^csv$|^xlsm$/.test(e)) return '📗'; if (/^doc/.test(e)) return '📘'; if (/^ppt/.test(e)) return '📙';
  if (/^(jpe?g|png|gif|webp|bmp|avif|tiff?)$/.test(e)) return '🖼️'; if (/^(zip|7z|rar|lzh)$/.test(e)) return '🗜️';
  if (/^(dwg|dxf|jww|jwc|sfc|dm)$/.test(e)) return '📐'; if (/^(mp4|mov|avi|mkv)$/.test(e)) return '🎞️'; if (/^(txt|md|log)$/.test(e)) return '📝';
  return '📄';
};
const nameOf = k => { const p = plain(k); return p === '/' ? (ctx.rootName || '最上位') : (p.split('/').pop() || p); };
function build() {
  const st = h('style'); st.textContent = CSS; document.head.appendChild(st);
  el = h('div', { id: 'lau' }); el.hidden = true;
  el.innerHTML = '<div class="lau-card"><div class="lau-head"><span class="lau-title">🚀 ランチャー</span><button class="lau-add" title="フォルダー・ファイルを、このグループに追加する">＋</button><button class="lau-view" title="表示(タイルの大きさ・一覧)">▦</button><button class="lau-lay" title="配置(浮かせる・画面を分割・別ウィンドウ・固定)">◫</button><button class="lau-rst" title="初期の大きさ・位置に戻す">⟲</button><button class="lau-more" title="その他(お気に入りから取り込む など)">⋯</button><button class="lau-min" title="最小化(見出しだけにする)">－</button><button class="lau-x" title="閉じる">✕</button></div>' +
    '<div class="lau-tabs"></div><div class="lau-grid"></div>' +
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => '<div class="lau-rz" data-d="' + d + '"></div>').join('') + '</div>';
  document.body.appendChild(el);
  card = el.querySelector('.lau-card'); tabsEl = el.querySelector('.lau-tabs'); gridEl = el.querySelector('.lau-grid');
  const at = (e, f) => { const r = e.currentTarget.getBoundingClientRect(); f(r.left, r.bottom + 4); };
  el.querySelector('.lau-x').onclick = () => { if (STANDALONE) standaloneClose(); else close(); };
  el.querySelector('.lau-min').onclick = e => { const m = card.classList.toggle('min'); e.currentTarget.textContent = m ? '▢' : '－'; e.currentTarget.title = m ? '元の大きさに戻す' : '最小化(見出しだけにする)'; }; // 別アプリ: 見出しだけにする/戻す
  el.querySelector('.lau-add').onclick = e => at(e, addMenu);
  el.querySelector('.lau-view').onclick = e => at(e, viewMenu);
  el.querySelector('.lau-lay').onclick = e => at(e, layMenu);
  el.querySelector('.lau-rst').onclick = () => resetLayout();
  el.querySelector('.lau-more').onclick = e => at(e, moreMenu);
  el.addEventListener('pointerdown', e => { if (e.target === el) el._bg = true; });
  el.addEventListener('click', e => { if (e.target === el && el._bg) { el._bg = false; close(); } }); // 「固定」を外しているときだけ、外側のタップで閉じる(固定のときは、外側を通す)
  el.addEventListener('touchmove', e => { if (drag && drag.on) e.preventDefault(); }, { passive: false }); // 動かしている間は、画面が流れない
  el.addEventListener('contextmenu', e => e.preventDefault());
  // エクスプローラーの一覧から、フォルダー・ファイルをドラッグして落とすと、登録する(グループのタブの上に落とすと、そのグループへ。それ以外は、いま見ているグループへ)
  const FB = 'application/x-fb-paths', clearHot = () => { card.classList.remove('lau-drop'); tabsEl.querySelectorAll('.hot').forEach(n => n.classList.remove('hot')); };
  card.addEventListener('dragover', e => {
    if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes(FB)) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; clearHot();
    const tab = e.target.closest && e.target.closest('.lau-tab[data-gid]'); if (tab) tab.classList.add('hot'); else card.classList.add('lau-drop');
  });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) clearHot(); });
  card.addEventListener('drop', e => {
    if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes(FB)) return;
    e.preventDefault(); e.stopPropagation(); clearHot();
    let paths = [], kinds = []; try { paths = JSON.parse(e.dataTransfer.getData(FB)); } catch {} try { kinds = JSON.parse(e.dataTransfer.getData('application/x-fb-kinds')); } catch {}
    if (!Array.isArray(paths) || !paths.length) return;
    const tab = e.target.closest && e.target.closest('.lau-tab[data-gid]');
    addKeys(paths.filter(p => typeof p === 'string').map((p, i) => keyOf(p, kinds[i] === undefined ? !/\.[^/.]{1,8}$/.test(p) : !!kinds[i])), tab ? tab.dataset.gid : undefined);
  });
  // 上の帯をつかんで動かす(浮かせているときだけ)
  const head = el.querySelector('.lau-head');
  head.addEventListener('pointerdown', e => {
    if (mode !== 'float' || e.button > 0 || e.target.closest('button')) return;
    e.preventDefault(); const g0 = curGeo(), sx = e.clientX, sy = e.clientY, id = e.pointerId; try { head.setPointerCapture(id); } catch {}
    const mv = ev => { geo = fit({ ...g0, x: g0.x + ev.clientX - sx, y: g0.y + ev.clientY - sy }); layout(); };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); saveState(); };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });
  // 縁・角をつかんで、大きさを変える(固定しているときは、境目を動かして、分割の幅・高さを変える)
  el.querySelectorAll('.lau-rz').forEach(hd => hd.addEventListener('pointerdown', e => {
    if (e.button > 0 || mode === 'fill') return; e.preventDefault(); e.stopPropagation();
    const d = hd.dataset.d, sx = e.clientX, sy = e.clientY, g0 = curGeo(), m = mode.slice(-1), d0 = dock[m] || DOCK0[m]; try { hd.setPointerCapture(e.pointerId); } catch {}
    const mv = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === 'float') {
        let { x, y, w, h } = g0;
        if (d.includes('e')) w = g0.w + dx; if (d.includes('s')) h = g0.h + dy;
        if (d.includes('w')) { w = g0.w - dx; x = g0.x + dx; } if (d.includes('n')) { h = g0.h - dy; y = g0.y + dy; }
        if (w < MINW) { if (d.includes('w')) x -= MINW - w; w = MINW; } if (h < MINH) { if (d.includes('n')) y -= MINH - h; h = MINH; }
        geo = fit({ x, y, w, h });
      } else { const dd = m === 'r' ? -dx : m === 'l' ? dx : -dy; dock[m] = clamp(d0 + dd, dockMin(m), Math.max(dockMin(m), dockMax(m))); }
      layout();
    };
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); saveState(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  }));
  window.addEventListener('resize', () => { if (shown) layout(); });
}
const chk = (on, t) => (on ? '✓ ' : '　') + t;
function setMode(m) { mode = m; saveState(); layout(); }
function setView(v) { view = v; saveState(); layout(); }
function viewMenu(x, y) {
  ctx.showMenu(x, y, [
    { label: chk(view === 's', 'タイル(小)'), fn: () => setView('s') }, { label: chk(view === 'm', 'タイル(中)'), fn: () => setView('m') },
    { label: chk(view === 'l', 'タイル(大)'), fn: () => setView('l') }, { label: chk(view === 'list', '一覧(1行ずつ)'), fn: () => setView('list') },
  ]);
}
function layMenu(x, y) {
  ctx.showMenu(x, y, [
    { label: chk(mode === 'float', '浮かせる(自由な位置・大きさ)'), fn: () => setMode('float') },
    { label: chk(mode === 'dock-r', '右に固定(画面を分割)'), fn: () => setMode('dock-r') },
    { label: chk(mode === 'dock-l', '左に固定(画面を分割)'), fn: () => setMode('dock-l') },
    { label: chk(mode === 'dock-b', '下に固定(画面を分割)'), fn: () => setMode('dock-b') },
    '-', { label: chk(pin, '📌 選んでも閉じない(固定)'), fn: () => { pin = !pin; saveState(); layout(); ctx.toast(pin ? '固定: フォルダー・ファイルを選んでも、閉じません' : '固定をやめました: 選ぶと、閉じます', 2200); } },
    '-', { label: '別ウィンドウ(ポップアップ)で開く', fn: () => popOut() },
  ]);
}
function moreMenu(x, y) {
  if (STANDALONE) { ctx.showMenu(x, y, ctx.moreItems ? ctx.moreItems() : []); return; } // 別アプリ: 再読み込み・ログアウトなど(専用ページ側が用意する)
  ctx.showMenu(x, y, [
    { label: '⭐ お気に入りから取り込む(足りない分だけ追加)', fn: () => importFavs() },
    { label: '📲 ホーム画面に追加', fn: () => installHelp() },
  ]);
}
function resetLayout() { geo = null; dock = { ...DOCK0 }; pin = true; mode = popup ? 'fill' : 'float'; saveState(); layout(); ctx.toast('初期の大きさ・位置(右下に固定・浮かせる)に戻しました', 2200); }
function popOut() {
  const w = window.open('/launcher/?lpopup=1', 'fb_launcher_popup', 'popup=yes,width=460,height=640');
  if (!w) { ctx.toast('別ウィンドウが、ブロックされました。ブラウザの設定で、許可してください', 4500); return; }
  close();
}
// お気に入り(フォルダー・ファイル)を、同じグループ名でランチャーに登録する。すでにあるものは重ねない。ランチャー側の変更・削除は消さない
function favGroups(doc, dir) {
  const out = [], key = p => (dir && p.length > 1 && !p.endsWith('/') ? p + '/' : p);
  const walk = (g, path) => { const name = path ? path + ' › ' + g.name : g.name; out.push({ name, items: (g.items || []).map(key) }); (g.groups || []).forEach(c => walk(c, name)); };
  if (doc && Array.isArray(doc.items) && doc.items.length) out.push({ name: dir ? 'お気に入り(未分類)' : 'ファイルお気に入り(未分類)', items: doc.items.map(key) });
  ((doc && doc.groups) || []).forEach(g => walk(g, ''));
  return out;
}
async function importFavs() {
  let a = null, b = null;
  try { const [r1, r2] = await Promise.all([ctx.api('GET', '/api/favorites'), ctx.api('GET', '/api/filefavs')]); a = r1.ok ? await r1.json() : null; b = r2.ok ? await r2.json() : null; } catch {}
  if (!a && !b) { ctx.toast('お気に入りを読み込めませんでした', 3000); return; }
  let added = 0, made = 0;
  const ok = await update(d => {
    added = 0; made = 0; const have = new Set(d.groups.flatMap(g => g.items).concat(d.items));
    [...favGroups(a, true), ...favGroups(b, false)].forEach(fg => {
      const fresh = fg.items.filter(k => !have.has(k)); if (!fresh.length) return;
      let g = d.groups.find(x => x.name === fg.name); if (!g) { g = { id: newGid(), name: fg.name, items: [], groups: [] }; d.groups.push(g); made++; }
      fresh.forEach(k => { g.items.push(k); have.add(k); added++; });
    });
  });
  if (ok) ctx.toast(added ? 'お気に入りから ' + added + ' 件を取り込みました(新しいグループ ' + made + ')' : '取り込むものは、ありませんでした(すべて登録済み)', 3000);
}
function render() {
  if (!el) return;
  const g = curGroup(); if (g) curGid = g.id;
  tabsEl.textContent = '';
  D.groups.forEach(x => {
    const b = h('button', { class: 'lau-tab' + (g && x.id === g.id ? ' on' : ''), 'data-gid': x.id, title: x.name }); b.textContent = x.name;
    dragify(b, { kind: 'tab', id: x.id, tap: () => { curGid = x.id; lsSet('fb_laugid', x.id); render(); }, menu: (px, py) => tabMenu(x, px, py) });
    tabsEl.appendChild(b);
  });
  const ad = h('button', { class: 'lau-tab add', title: '新しいグループを作る' }, '＋ グループ'); ad.onclick = () => newGroup(); tabsEl.appendChild(ad);
  gridEl.textContent = '';
  if (!g) { gridEl.appendChild(h('div', { class: 'lau-empty' }, '読み込み中…')); return; }
  if (!g.items.length) gridEl.appendChild(h('div', { class: 'lau-empty' }, 'このグループには、まだ何も登録されていません。<br>右上の「＋ 追加」から、いま開いているフォルダーや、選んだファイルを登録できます。<br>(エクスプローラーで右クリック/長押し →「ランチャーに追加」でも登録できます)'));
  g.items.forEach(k => {
    const t = h('div', { class: 'lau-tile', 'data-k': k, title: ctx.winPath ? ctx.winPath(plain(k)) : k });
    t.innerHTML = `<span class="ic">${iconOf(k)}</span><span class="nm">${esc(nameOf(k))}</span>`;
    dragify(t, { kind: 'tile', id: k, tap: () => openEntry(k), menu: (px, py) => tileMenu(k, px, py) });
    gridEl.appendChild(t);
  });
}

/* ---------- ドラッグ: 並べ替え・別のグループへ移動 ---------- */
// マウス: 少し動かすとドラッグ / 指: 約0.35秒の長押しのあとで動かす(先に動かすと、ふつうのスクロール)。長押しして動かさずに離す(マウスは右クリック)と、メニュー
function dragify(node, o) {
  node.addEventListener('pointerdown', e => {
    if (e.button > 0) return; const mouse = e.pointerType === 'mouse', id = e.pointerId;
    const st = drag = { on: false, x: e.clientX, y: e.clientY, moved: false, timer: 0, ghost: null, target: null, pos: '', kind: o.kind, key: o.id };
    const clear = () => el.querySelectorAll('.ins-b,.ins-a,.hot').forEach(n => n.classList.remove('ins-b', 'ins-a', 'hot'));
    const start = () => {
      st.on = true; node.classList.add('lau-src'); try { node.setPointerCapture(id); } catch {}
      const r = node.getBoundingClientRect(), gh = node.cloneNode(true); gh.classList.remove('lau-src'); gh.classList.add('lau-ghost'); gh.style.width = r.width + 'px'; gh.style.height = r.height + 'px';
      st.dx = st.x - r.left; st.dy = st.y - r.top; document.body.appendChild(gh); st.ghost = gh; place(e.clientX, e.clientY);
      try { if (navigator.vibrate) navigator.vibrate(12); } catch {}
    };
    const place = (x, y) => { st.ghost.style.left = (x - st.dx) + 'px'; st.ghost.style.top = (y - st.dy) + 'px'; };
    const off = () => { clearTimeout(st.timer); node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel); };
    const finish = () => { off(); clear(); node.classList.remove('lau-src'); if (st.ghost) st.ghost.remove(); drag = null; };
    const mv = ev => {
      const dist = Math.hypot(ev.clientX - st.x, ev.clientY - st.y);
      if (!st.on) { if (dist <= 8) return; if (mouse) start(); else { finish(); return; } } // 指で先に動かした: ふつうのスクロール
      st.moved = true; place(ev.clientX, ev.clientY); clear(); st.target = null; st.pos = '';
      const hit = document.elementFromPoint(ev.clientX, ev.clientY); if (!hit) return;
      const tile = hit.closest('.lau-tile'), tab = hit.closest('.lau-tab[data-gid]');
      const half = n => { const r = n.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2 ? 'b' : 'a'; };
      if (o.kind === 'tile') {
        if (tile && tile.dataset.k !== o.id) { st.target = { type: 'tile', key: tile.dataset.k }; st.pos = half(tile); tile.classList.add('ins-' + st.pos); }
        else if (tab && tab.dataset.gid !== curGroup().id) { st.target = { type: 'tab', gid: tab.dataset.gid }; tab.classList.add('hot'); }
        else if (hit.closest('.lau-grid') && !tile) st.target = { type: 'end' };
      } else if (tab && tab.dataset.gid !== o.id) { st.target = { type: 'tab', gid: tab.dataset.gid }; st.pos = half(tab); tab.classList.add('ins-' + st.pos); }
      const gr = gridEl.getBoundingClientRect(); if (o.kind === 'tile') { if (ev.clientY < gr.top + 26) gridEl.scrollTop -= 14; else if (ev.clientY > gr.bottom - 26) gridEl.scrollTop += 14; }
    };
    const up = ev => {
      const was = st.on, moved = st.moved, target = st.target, pos = st.pos; finish();
      if (was && moved) { if (target) dropOn(o, target, pos); return; }
      if (was) { o.menu(ev.clientX, ev.clientY); return; } // 長押しして動かさずに離した
      o.tap();
    };
    const cancel = () => finish();
    if (!mouse) st.timer = setTimeout(() => { if (drag === st) start(); }, 350);
    node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cancel);
  });
  node.addEventListener('contextmenu', e => { e.preventDefault(); if (e.pointerType === 'mouse' || !('ontouchstart' in window)) o.menu(e.clientX, e.clientY); });
}
function dropOn(o, t, pos) {
  if (o.kind === 'tile') {
    const k = o.id, from = curGroup();
    if (t.type === 'tab') return update(d => { rmKey(d, k); grp(d, t.gid).items.push(k); });
    update(d => {
      const g = grp(d, from.id); g.items = g.items.filter(x => x !== k);
      if (t.type === 'tile') { let i = g.items.indexOf(t.key); if (i < 0) i = g.items.length; else if (pos === 'a') i++; g.items.splice(i, 0, k); } else g.items.push(k);
    });
  } else if (t.type === 'tab') {
    const gid = o.id; update(d => {
      const i0 = d.groups.findIndex(g => g.id === gid); if (i0 < 0) return; const [g] = d.groups.splice(i0, 1);
      let i = d.groups.findIndex(x => x.id === t.gid); if (i < 0) i = d.groups.length; else if (pos === 'a') i++; d.groups.splice(i, 0, g);
    });
  }
}

/* ---------- メニュー・操作 ---------- */
function tabMenu(g, x, y) {
  const i = D.groups.findIndex(q => q.id === g.id);
  ctx.showMenu(x, y, [
    { label: '名前の変更', fn: () => renameGroup(g.id) },
    { label: '左へ移動', dis: i <= 0, fn: () => update(d => { const j = d.groups.findIndex(q => q.id === g.id); if (j > 0) [d.groups[j - 1], d.groups[j]] = [d.groups[j], d.groups[j - 1]]; }) },
    { label: '右へ移動', dis: i >= D.groups.length - 1, fn: () => update(d => { const j = d.groups.findIndex(q => q.id === g.id); if (j >= 0 && j < d.groups.length - 1) [d.groups[j + 1], d.groups[j]] = [d.groups[j], d.groups[j + 1]]; }) },
    '-', { label: 'このグループを削除', dis: D.groups.length < 2, fn: () => deleteGroup(g.id) },
  ]);
}
function tileMenu(k, x, y) {
  const g = curGroup();
  ctx.showMenu(x, y, [
    { label: '開く', fn: () => openEntry(k) },
    { label: 'エクスプローラーで、場所を開く', fn: () => openEntry(isDirKey(k) ? k : k.replace(/[^/]+$/, '') || '/') },
    '-', ...D.groups.filter(q => !g || q.id !== g.id).map(q => ({ label: '「' + q.name + '」へ移動', fn: () => update(d => { rmKey(d, k); grp(d, q.id).items.push(k); }) })),
    '-', { label: '登録を削除(ファイルは消えません)', fn: () => update(d => rmKey(d, k)) },
  ]);
}
function addMenu(x, y) {
  const cwd = ctx.cwd(), sel = ctx.selection();
  ctx.showMenu(x, y, [
    { label: 'いま開いているフォルダーを追加', fn: () => addKeys([keyOf(cwd, true)]) },
    { label: '選んでいる項目を追加' + (sel.length ? '(' + sel.length + '件)' : '(なし)'), dis: !sel.length, fn: () => addKeys(sel.map(s => keyOf(s.path, s.dir))) },
  ]);
}
async function addKeys(keys, gid) {
  keys = [...new Set(keys)]; const have = new Set(allKeys()), fresh = keys.filter(k => !have.has(k));
  if (!fresh.length) { ctx.toast('すでに登録されています', 2000); return; }
  const target = gid || (curGroup() && curGroup().id);
  const ok = await update(d => { const g = grp(d, target) || d.groups[0]; if (g) g.items.push(...fresh); });
  if (ok) ctx.toast('ランチャーに' + fresh.length + '件を追加しました' + (fresh.length < keys.length ? '(登録済みの' + (keys.length - fresh.length) + '件は除く)' : ''), 2200);
}
async function askName(title, value) {
  const r = await ctx.dialog({ title, body: '<p>グループの名前を入力してください</p>', input: value, buttons: [{ label: 'OK', value: true, cls: 'primary' }, { label: 'キャンセル', value: false, cancel: true }] });
  const name = (r.text || '').trim().slice(0, 60); return r.value && name ? name : null;
}
async function newGroup() {
  const name = await askName('新しいグループ', ''); if (!name) return; const id = newGid();
  if (await update(d => { d.groups.push({ id, name, items: [], groups: [] }); })) { curGid = id; lsSet('fb_laugid', id); render(); }
}
async function renameGroup(gid) { const g = grp(D, gid); if (!g) return; const name = await askName('グループ名の変更', g.name); if (name) update(d => { const x = grp(d, gid); if (x) x.name = name; }); }
async function deleteGroup(gid) {
  const g = grp(D, gid); if (!g || D.groups.length < 2) return;
  const r = await ctx.dialog({ title: 'グループの削除', body: `<p>「${esc(g.name)}」を削除します。中の登録(${g.items.length}件)も消えます。ファイル・フォルダー本体は消えません。</p>`, buttons: [{ label: '削除', value: true, cls: 'danger' }, { label: 'キャンセル', value: false, cancel: true }] });
  if (r.value) update(d => { d.groups = d.groups.filter(x => x.id !== gid); });
}
async function installHelp() {
  if (ctx.isLauncherPage && installEvt) { const ev = installEvt; installEvt = null; try { await ev.prompt(); } catch {} return; }
  const url = location.origin + '/launcher/';
  await ctx.dialog({ title: 'ランチャーをホーム画面に追加', body: ctx.isLauncherPage
    ? '<p>ブラウザ(Chrome)のメニュー「⋮」→「アプリをインストール」(または「ホーム画面に追加」)を押してください。すでに追加済みのときは、ホーム画面の「ランチャー」のアイコンから開けます。</p>'
    : '<p><b>方法1(おすすめ)</b>:ランチャー専用のページを開いて、Chrome のメニュー「⋮」→「アプリをインストール」(または「ホーム画面に追加」)を押します。ホーム画面に、青い「ランチャー」のアイコンができます。</p><p><a href="/launcher/">ここを押して、ランチャー専用のページを開く</a><br><small style="word-break:break-all">' + esc(url) + '</small></p><p><b>方法2</b>:このアプリのアイコンを長押しして、出てきた「ランチャー」を、ホーム画面へ引っぱり出します(アプリを入れ直した後、反映まで1〜2日かかることがあります)。</p>',
    buttons: [{ label: '閉じる', value: true, cls: 'primary', cancel: true }] });
}
// 別ウィンドウ(ポップアップ)のランチャーは、選んだ項目を、元のエクスプローラーの窓へ送って開かせる(BroadcastChannel)
const bc = (() => { try { return 'BroadcastChannel' in window ? new BroadcastChannel('fb_launcher') : null; } catch { return null; } })();
function sendToMain(k) {
  return new Promise(res => {
    if (!bc) return res(false);
    const on = e => { if (e.data && e.data.t === 'ack') { clearTimeout(tm); bc.removeEventListener('message', on); res(true); } };
    const tm = setTimeout(() => { bc.removeEventListener('message', on); res(false); }, 700);
    bc.addEventListener('message', on); bc.postMessage({ t: 'open', k });
  });
}
async function openHere(k) {
  const dir = isDirKey(k), p = plain(k);
  if (dir) { if (window.PdfView && PdfView.isOpen()) PdfView.hide(); if (!(await ctx.go(p))) ctx.toast('フォルダーが見つかりません。ランチャーで、登録を削除できます', 4000); }
  else await ctx.openFile(p);
}
async function openEntry(k) {
  ctx.hideMenu();
  if (popup) { if (await sendToMain(k)) return; popup = false; mode = 'float'; layout(); } // 元の窓が無い: この窓を、ふつうのエクスプローラーとして使う
  if (!pin && mode !== 'fill') close(); // 固定をやめているときだけ、選ぶと閉じる
  await openHere(k);
}
if (bc) bc.onmessage = e => { if (popup || !e.data || e.data.t !== 'open' || typeof e.data.k !== 'string') return; bc.postMessage({ t: 'ack' }); try { window.focus(); } catch {} openHere(e.data.k); };

/* ---------- 出し入れ・呼び出し ---------- */
async function open() {
  if (!ctx || shown) return; if (!el) build();
  shown = true; el.hidden = false; ctx.hideMenu(); layout();
  render(); await fetchDoc();
  if (shown && !D.groups.length) { await update(d => { d.groups.push({ id: newGid(), name: 'グループ1', items: [], groups: [] }); }); }
}
function standaloneClose() { // 別アプリ: 窓ごと閉じる。ブラウザが閉じさせない窓(アプリとして入れたもの)では、閉じられないので、案内を出す
  try { window.close(); } catch {}
  setTimeout(() => { if (document.visibilityState === 'visible') ctx.toast('この窓は、アプリからは閉じられません。窓の上の帯(つまみ)から閉じてください', 4500); }, 500);
}
function close() {
  if (!shown || STANDALONE) return;
  if (popup) { try { window.close(); } catch {} } // 別ウィンドウは、窓ごと閉じる(閉じられないときは、隠すだけ)
  shown = false; el.hidden = true; drag = null; layout();
}
// エクスプローラーの右クリック/長押しメニューから: 選んだ項目を、どのグループへ入れるか選んで追加する
async function addTo(entries, x, y) {
  if (!entries.length) return; if (!D.groups.length) await fetchDoc();
  const keys = entries.map(s => keyOf(s.path, s.dir));
  ctx.showMenu(x, y, [...D.groups.map(g => ({ label: '「' + g.name + '」へ追加', fn: () => addKeys(keys, g.id) })), ...(D.groups.length ? ['-'] : []), { label: '新しいグループを作って追加…', fn: async () => { const name = await askName('新しいグループ', ''); if (!name) return; const id = newGid(); if (await update(d => { d.groups.push({ id, name, items: [], groups: [] }); })) addKeys(keys, id); } }]);
}
function eligible() {
  const a = document.activeElement, tag = a && a.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (a && a.isContentEditable)) return false;
  return ctx.ovDepth() === 0 && !(window.PdfView && PdfView.isOpen());
}
function bindTriggers() {
  // パソコン: Esc を2回(0.45秒以内)。ランチャーが開いているときの Esc は、閉じる
  let e1 = null;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.repeat) return;
    const now = performance.now(), depth = ctx.ovDepth();
    if (shown) { // 開いているとき: Esc を2回で閉じる(固定をやめているときは、1回で閉じる)。固定のときの1回目は、ふつうの Esc として、エクスプローラーへ通す
      if (popup) return;
      if ((e1 && now - e1.t < 450) || (!pin && mode === 'float')) { e1 = null; e.preventDefault(); e.stopPropagation(); ctx.hideMenu(); close(); return; }
      e1 = { t: now, depth }; return;
    }
    if (e1 && now - e1.t < 450 && e1.depth === 0 && depth === 0 && eligible()) { e1 = null; e.preventDefault(); open(); return; }
    e1 = { t: now, depth };
  }, true);
  // 携帯: 何もない所(一覧の空き・上のタイトル帯・下の状態帯など)を2回タップ。項目やボタンの上は、数えない(1回目のタップで、開いてしまうため)
  const blank = t => t && (t.id === 'list' || t.id === 'content' || t.id === 'main' || (t.closest && t.closest('#titlebar,#statusbar,#cmdbar,#tabbar') && !t.closest('button,input,a,.tab,select')));
  let t0 = null, lt = null;
  document.addEventListener('touchstart', e => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null; if (e.touches.length > 1) lt = null; }, { passive: true, capture: true });
  document.addEventListener('touchend', e => {
    if (!ctx.touchDev || !t0 || e.changedTouches.length !== 1 || e.touches.length) return;
    const t = e.changedTouches[0], now = performance.now(), s = t0; t0 = null;
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 12 || now - s.t > 350 || !blank(e.target) || shown || !eligible()) { lt = null; return; }
    if (lt && now - lt.t < 380 && Math.hypot(t.clientX - lt.x, t.clientY - lt.y) < 40) { lt = null; open(); return; }
    lt = { x: t.clientX, y: t.clientY, t: now };
  }, { passive: true, capture: true });
}
function init(c) { if (ctx) return; ctx = c; bindTriggers(); if (popup) { build(); layout(); } } // 別ウィンドウ: 起動の直後から、エクスプローラーを隠す
window.Launcher = { init, open, close, addTo, isOpen: () => shown, onRev: rev => { if (rev !== D.rev) fetchDoc(); } };
})();
