// ランチャー専用アプリ(別アプリ)の土台。launcher.js(エクスプローラーのランチャーと同じ画面)に、この端末だけの道具(ログイン・保存先・メニュー・ダイアログ)を渡す。
// サーバーのアドレスは、公開しないため、このコードには書かない。最初に1回だけ入れる(端末に保存)。 例: https://サーバー名/#server=https://サーバー名 で開くと、自動で入る
(() => {
'use strict';
const ls = { get: (k, d = '') => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
const $ = id => document.getElementById(id);
const trimUrl = s => String(s || '').trim().replace(/\/+$/, '');
const SRV_RE = /^(https:\/\/[^/\s]+|http:\/\/(127\.0\.0\.1|localhost))(:\d+)?$/; // https だけ(試験用に、この端末の 127.0.0.1 だけ http も可)
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/; // Android のアプリの識別名(パッケージ名)。例: org.chromium.webapk.xxxxxxxx_v2
let SERVER = trimUrl(ls.get('lau_server')), TOKEN = ls.get('lau_token'), USER = ls.get('lau_user'), PKG = ls.get('lau_pkg');

// 初回: アドレスの #server=… を取り込み、アドレス欄からは消す
try {
  const m = /[#&]server=([^&]+)/.exec(location.hash);
  const mp = /[#&]pkg=([^&]+)/.exec(location.hash); // エクスプローラーのアプリの識別名(任意)。あると、右に開いているエクスプローラーの窓を、直接呼べる
  if (m) { const s = trimUrl(decodeURIComponent(m[1])); if (SRV_RE.test(s)) { SERVER = s; ls.set('lau_server', s); } }
  if (mp) { const k = decodeURIComponent(mp[1]).trim(); if (PKG_RE.test(k)) { PKG = k; ls.set('lau_pkg', k); } }
  if (m || mp) history.replaceState(null, '', location.pathname + location.search);
} catch {}

/* ---------- 画面部品 ---------- */
let toastEl = null, toastTm = 0;
function toast(msg, ms = 2400) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sa-toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTm); toastTm = setTimeout(() => { toastEl.hidden = true; }, ms);
}
let menuEl = null;
function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showMenu(x, y, items) {
  hideMenu(); const m = document.createElement('div'); m.className = 'sa-menu';
  (items || []).forEach(it => {
    if (it === '-') { m.appendChild(document.createElement('hr')); return; }
    const d = document.createElement('div'); d.textContent = it.label; if (it.dis) d.className = 'dis';
    d.onclick = () => { hideMenu(); try { it.fn && it.fn(); } catch {} }; m.appendChild(d);
  });
  document.body.appendChild(m); menuEl = m;
  const r = m.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px'; m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (menuEl && !menuEl.contains(e.target)) { hideMenu(); } document.removeEventListener('pointerdown', off, true); }, true), 0);
}
function dialog(o) {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sa-dlg-bg';
    const d = document.createElement('div'); d.className = 'sa-dlg'; bg.appendChild(d);
    const h = document.createElement('h2'); h.textContent = o.title || ''; d.appendChild(h);
    const b = document.createElement('div'); b.innerHTML = o.body || ''; d.appendChild(b);
    let inp = null; if (o.input !== undefined) { inp = document.createElement('input'); inp.type = 'text'; inp.value = o.input || ''; d.appendChild(inp); }
    const bt = document.createElement('div'); bt.className = 'bt'; d.appendChild(bt);
    const done = (value) => { bg.remove(); res({ value, text: inp ? inp.value : '' }); };
    (o.buttons || [{ label: 'OK', value: true, cls: 'primary' }]).forEach(x => { const k = document.createElement('button'); k.textContent = x.label; if (x.cls) k.className = x.cls; k.onclick = () => done(x.value); bt.appendChild(k); });
    bg.addEventListener('pointerdown', e => { if (e.target === bg) { const c = (o.buttons || []).find(x => x.cancel); if (c) done(c.value); } });
    document.body.appendChild(bg); if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const p = (o.buttons || []).find(x => x.cls === 'primary'); done(p ? p.value : true); } }); }
  });
}

/* ---------- サーバーとの通信 ---------- */
async function api(method, path, opt = {}) {
  if (!SERVER) { showLogin(); throw new Error('no server'); }
  const r = await fetch(SERVER + path, { method, headers: { ...(opt.headers || {}), 'X-Auth': TOKEN }, body: opt.body, cache: 'no-store' });
  if (r.status === 401) { TOKEN = ''; ls.del('lau_token'); showLogin('ログインの有効期限が切れました。もう一度ログインしてください'); }
  return r;
}
function showLogin(msg) {
  $('login').hidden = false; $('lf-srv').value = SERVER; $('lf-pkg').value = PKG || ''; $('lf-user').value = USER || ''; $('lf-pw').value = ''; $('lf-err').textContent = msg || '';
  (SERVER ? ($('lf-user').value ? $('lf-pw') : $('lf-user')) : $('lf-srv')).focus();
}
$('lf').addEventListener('submit', async e => {
  e.preventDefault(); const srv = trimUrl($('lf-srv').value), user = $('lf-user').value.trim(), pw = $('lf-pw').value; const err = $('lf-err'); err.textContent = '';
  if (!SRV_RE.test(srv)) { err.textContent = 'サーバーのアドレスは、https:// から始めて、入れてください'; return; }
  if (!user || !pw) { err.textContent = 'ユーザー名とパスワードを入れてください'; return; }
  const pk = $('lf-pkg').value.trim(); if (pk && !PKG_RE.test(pk)) { err.textContent = '識別名の形が違います(例: org.chromium.webapk.xxxxxxxx_v2)。空にすると、使いません'; return; }
  PKG = pk; if (pk) ls.set('lau_pkg', pk); else ls.del('lau_pkg');
  err.textContent = 'ログイン中…';
  try {
    const r = await fetch(srv + '/api/login', { method: 'POST', body: JSON.stringify({ username: user, password: pw, scope: 'launcher' }) });
    if (r.status === 429) { err.textContent = '失敗が続いたため、しばらく入れません。時間をおいてください'; return; }
    if (!r.ok) { err.textContent = 'ユーザー名またはパスワードが違います'; return; }
    TOKEN = await r.text(); SERVER = srv; USER = user; ls.set('lau_server', srv); ls.set('lau_token', TOKEN); ls.set('lau_user', user);
    $('login').hidden = true; $('lf-pw').value = ''; start();
  } catch { err.textContent = 'サーバーにつながりません(アドレス・通信を確認してください)'; }
});

/* ---------- 項目を開く: エクスプローラーのアプリへ渡す ---------- */
// リンクのタップとして開く(携帯は、入れてあるエクスプローラーのアプリが引き取る)。window.open だと、引き取られないことがあるため
// 識別名(PKG)があるときは、Android の「インテント」で、エクスプローラーのアプリを名指しで呼ぶ。すでに開いている窓(分割画面の右など)が、そのまま、指定のフォルダーへ移る。
// 無いときは、ふつうのリンクとして開く(引き取られるアプリは、携帯が決める。ランチャーの窓の中で開いてしまうことがある)
function explorerUrl(kind, p) { return SERVER + '/static/img/explorer.html?' + (kind === 'dir' ? 'go=' : 'open=') + encodeURIComponent(p); }
function intentUrl(kind, p, pkg) {
  const https = explorerUrl(kind, p), u = new URL(https);
  return 'intent://' + u.host + u.pathname + u.search + '#Intent;scheme=' + u.protocol.replace(':', '') + ';package=' + pkg + ';S.browser_fallback_url=' + encodeURIComponent(https) + ';end';
}
// まず、サーバー経由で、いま開いているエクスプローラーの窓(携帯)に、指示を送る。窓の配置(分割・ポップアップ)に関係なく届く。届いた窓が無ければ、アプリを起動する
async function openInExplorer(kind, p) {
  try {
    const r = await api('POST', '/api/goto', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, kind, dev: isPhone() ? 'phone' : 'pc', tab: kind === 'dir' && OPENMODE === 'new' ? 'new' : 'cur' }) });
    if (r.ok) { const j = await r.json().catch(() => null); if (j && j.delivered > 0) { toast(kind === 'dir' ? 'エクスプローラーで開きました' : 'エクスプローラーに送りました', 1500); return true; } }
  } catch {}
  return launchExplorerApp(kind, p);
}
// 開き方: 'new'=タップするたびに、エクスプローラーの新しいタブで開く(既定)/ 'cur'=いま開いているタブで開く(従来)
let OPENMODE = ls.get('lau_open', 'new') === 'cur' ? 'cur' : 'new';
const isPhone = () => (navigator.maxTouchPoints > 0) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); // 携帯か(パソコンのブラウザは、インテントが使えない)
// パソコン(複数のモニター): エクスプローラーを、いちばん右のモニターに、そのモニターいっぱいの窓で出す。
// モニターの位置は、ブラウザの許可(「すべてのディスプレイ上のウィンドウを管理」)が要る。最初にページを触ったとき、1回だけ聞く(押した直後に聞くと、窓を開く許可の時間が切れるため)
let SCREENS = null;
function rightScreenRect(list) { // list: [{left,top,width,height}](作業領域)。いちばん右(左端が最大)のもの
  if (!list || !list.length) return null;
  const s = list.reduce((m, x) => (x.left > m.left ? x : m), list[0]);
  return { left: Math.round(s.left), top: Math.round(s.top), width: Math.round(s.width), height: Math.round(s.height) };
}
async function loadScreens() {
  if (isPhone() || !screen.isExtended) { SCREENS = null; return; } // 携帯・モニターが1枚のときは使わない
  try {
    const d = await window.getScreenDetails();
    const conv = () => d.screens.map(x => ({ left: x.availLeft, top: x.availTop, width: x.availWidth, height: x.availHeight }));
    SCREENS = conv(); d.onscreenschange = () => { SCREENS = conv(); };
  } catch { SCREENS = null; } // 許可されない・使えない: いまのモニターの右隣と見なす(launchExplorerApp)
}
if (!isPhone()) document.addEventListener('pointerdown', () => loadScreens(), { once: true });
function popupRect() {
  if (isPhone() || !screen.isExtended) return null;
  return rightScreenRect(SCREENS) || { left: (screen.availLeft || 0) + screen.availWidth, top: screen.availTop || 0, width: screen.availWidth, height: screen.availHeight };
}
function launchExplorerApp(kind, p) {
  const url = explorerUrl(kind, p), r = popupRect();
  if (r) { // パソコンで、モニターが複数: 右のモニターに窓を開く。ブロックされたら、ふつうのリンクへ
    const w = window.open(url, 'fb_explorer', 'popup=yes,left=' + r.left + ',top=' + r.top + ',width=' + r.width + ',height=' + r.height);
    if (w) { try { w.focus(); } catch {} return true; }
  }
  const a = document.createElement('a');
  if (isPhone() && PKG && PKG_RE.test(PKG)) a.href = intentUrl(kind, p, PKG);
  else { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
  document.body.appendChild(a); a.click(); a.remove();
  return true;
}

/* ---------- 起動 ---------- */
let started = false;
function start() {
  if (!window.Launcher) return;
  if (!started) {
    started = true;
    Launcher.init({
      api, toast, dialog, showMenu, hideMenu, ovOpen() {}, ovClose() {}, ovDepth: () => 0, TOUCH: true, touchDev: true, rootName: '最上位', winPath: p => p, isLauncherPage: false,
      go: async p => openInExplorer('dir', p), openFile: async p => openInExplorer('file', p),
      cwd: () => '/', selection: () => [],
      sendTabCmd: async cmd => { // エクスプローラーの、いまのタブへの操作(サーバー経由で、窓へ指示)
        try { const r = await api('POST', '/api/tabcmd', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, dev: isPhone() ? 'phone' : 'pc' }) }); const j = r.ok ? await r.json().catch(() => null) : null; if (!(j && j.delivered > 0)) toast('エクスプローラーの窓が見つかりません', 1800); } catch { toast('つながりません', 1800); }
      },
      closeExplorerTab: async () => { // エクスプローラーの、いま開いているタブを閉じる(サーバー経由で、窓へ指示)
        try { const r = await api('POST', '/api/tabcmd', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'closeTab', dev: isPhone() ? 'phone' : 'pc' }) }); const j = r.ok ? await r.json().catch(() => null) : null; toast(j && j.delivered > 0 ? 'エクスプローラーのタブを閉じました' : 'エクスプローラーの窓が見つかりません', 1800); } catch { toast('つながりません', 1800); }
      },
      moreItems: () => [
        { label: OPENMODE === 'new' ? '✓ タップで、常に新しいタブで開く(押すと「いまのタブ」に切り替え)' : '✓ タップで、いまのタブで開く(押すと「常に新しいタブ」に切り替え)', fn: () => { OPENMODE = OPENMODE === 'new' ? 'cur' : 'new'; ls.set('lau_open', OPENMODE); toast(OPENMODE === 'new' ? '常に新しいタブで開きます' : 'いまのタブで開きます', 2200); } },
        { label: '📂 エクスプローラーのアプリを起動', fn: () => launchExplorerApp('dir', '/') },
        { label: '🔄 再読み込み', fn: () => location.reload() },
        { label: 'サーバー・ログインの設定', fn: () => showLogin('') },
        { label: 'ログアウト', fn: () => { TOKEN = ''; ls.del('lau_token'); showLogin('ログアウトしました'); } },
        '-', { label: '版: ' + (window.LAUNCHER_VER || '不明'), dis: true },
      ],
    });
    // 登録の変更を、ほかの端末と合わせる(エクスプローラー側は、すぐ反映される。こちらは定期的に読み直す)
    const poll = () => { if (document.visibilityState === 'visible' && TOKEN) Launcher.onRev(-1); };
    setInterval(poll, 20000); document.addEventListener('visibilitychange', poll);
  }
  Launcher.open();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!SERVER || !TOKEN) showLogin(); else start();
})();
