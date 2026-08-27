// ==UserScript==
// @name         X Force Mute
// @namespace    https://github.com/shapoco/x-force-mute
// @version      1.0.0
// @description  Hide posts on X (Twitter) by screen name, keyword, or regexp - works on Lists, where the built-in mute does not.
// @description:ja X (Twitter) のリストでも効くミュート。screen name / キーワード / 正規表現にマッチしたポスト (リポスト・引用リポスト含む) を非表示にします。
// @author       shapoco
// @homepageURL  https://github.com/shapoco/x-force-mute
// @supportURL   https://github.com/shapoco/x-force-mute/issues
// @downloadURL  https://raw.githubusercontent.com/shapoco/x-force-mute/main/dist/x-force-mute.user.js
// @updateURL    https://raw.githubusercontent.com/shapoco/x-force-mute/main/dist/x-force-mute.user.js
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  var STORE_KEY = 'xfm_rules_text';
  var AVATAR_PREFIX = 'UserAvatar-Container-';

  /* ------------------------------------------------------------------ *
   * 設定の保存 / 読み込み
   * ------------------------------------------------------------------ */
  var hasGM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');

  function loadRaw() {
    try {
      if (hasGM) return GM_getValue(STORE_KEY, '') || '';
      return localStorage.getItem(STORE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function saveRaw(text) {
    try {
      if (hasGM) GM_setValue(STORE_KEY, text);
      else localStorage.setItem(STORE_KEY, text);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * ルールのパース
   *   @name  -> screen name (投稿者・リポスト元・引用元にマッチ)
   *   /re/   -> 本文の正規表現
   *   その他 -> 本文の部分一致 (大文字小文字を無視)
   * ------------------------------------------------------------------ */
  var rules = { handles: Object.create(null), regexps: [], keywords: [] };

  function parseRules(text) {
    var handles = Object.create(null);
    var regexps = [];
    var keywords = [];
    var lines = String(text || '').split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.charAt(0) === '@') {
        var hm = /^[A-Za-z0-9_]{1,20}/.exec(line.slice(1).trim());
        if (hm) handles[hm[0].toLowerCase()] = true;
        continue;
      }

      var m = /^\/(.+)\/([a-zA-Z]*)$/.exec(line);
      if (m) {
        var flags = m[2] ? m[2].replace(/[gy]/g, '') : 'i';
        var re = null;
        try {
          re = new RegExp(m[1], flags);
        } catch (e) {
          re = null; /* 不正な正規表現はキーワード扱いにフォールバック */
        }
        if (re) {
          regexps.push(re);
          continue;
        }
      }

      keywords.push(line.toLowerCase());
    }

    return { handles: handles, regexps: regexps, keywords: keywords };
  }

  function hasAnyRule() {
    for (var k in rules.handles) return true;
    return rules.regexps.length > 0 || rules.keywords.length > 0;
  }

  /* ------------------------------------------------------------------ *
   * ポストからの情報の抽出
   * ------------------------------------------------------------------ */
  function handleFromHref(href) {
    if (!href || href.charAt(0) !== '/') return '';
    var seg = href.slice(1).split(/[\/?#]/)[0];
    return /^[A-Za-z0-9_]{1,20}$/.test(seg) ? seg.toLowerCase() : '';
  }

  // 投稿者・リポストした人・引用元の投稿者をすべて集める
  function collectHandles(article) {
    var found = [];
    var i, h;

    // アバター (投稿者本人 + 引用元の投稿者)
    var avatars = article.querySelectorAll('[data-testid^="' + AVATAR_PREFIX + '"]');
    for (i = 0; i < avatars.length; i++) {
      h = avatars[i].getAttribute('data-testid').slice(AVATAR_PREFIX.length).toLowerCase();
      if (h && h !== 'unknown') found.push(h);
    }

    // 表示名の行のリンク
    var nameLinks = article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]');
    for (i = 0; i < nameLinks.length; i++) {
      h = handleFromHref(nameLinks[i].getAttribute('href'));
      if (h) found.push(h);
    }

    // 「○○ さんがリポスト」の行
    var social = article.querySelectorAll('[data-testid="socialContext"]');
    for (i = 0; i < social.length; i++) {
      var a = social[i].closest('a[href^="/"]');
      if (a) {
        h = handleFromHref(a.getAttribute('href'));
        if (h) found.push(h);
      }
    }

    return found;
  }

  // 本文 (引用されたポストの本文も含む)
  function collectText(article) {
    var texts = article.querySelectorAll('[data-testid="tweetText"]');
    var buf = [];
    for (var i = 0; i < texts.length; i++) buf.push(texts[i].textContent || '');
    return buf.join('\n');
  }

  function matches(article) {
    var i;

    var handles = collectHandles(article);
    for (i = 0; i < handles.length; i++) {
      if (rules.handles[handles[i]]) return true;
    }

    if (rules.regexps.length || rules.keywords.length) {
      var text = collectText(article);
      if (text) {
        for (i = 0; i < rules.regexps.length; i++) {
          rules.regexps[i].lastIndex = 0;
          if (rules.regexps[i].test(text)) return true;
        }
        if (rules.keywords.length) {
          var lower = text.toLowerCase();
          for (i = 0; i < rules.keywords.length; i++) {
            if (lower.indexOf(rules.keywords[i]) !== -1) return true;
          }
        }
      }
    }

    return false;
  }

  /* ------------------------------------------------------------------ *
   * 非表示の適用
   * ------------------------------------------------------------------ */
  var mutedCount = 0;

  // タイムラインの行 (cellInnerDiv) ごと隠す。行が無ければポスト本体を隠す。
  function hideTarget(article) {
    return article.closest('[data-testid="cellInnerDiv"]') || article;
  }

  function apply() {
    var articles = document.querySelectorAll('article[data-testid="tweet"]');
    var active = hasAnyRule();
    var count = 0;
    var i;

    for (i = 0; i < articles.length; i++) {
      var article = articles[i];
      var target = hideTarget(article);
      var hit = active && matches(article);

      if (hit) {
        count++;
        if (target.getAttribute('data-xfm-muted') !== '1') {
          target.setAttribute('data-xfm-muted', '1');
        }
      } else if (target.hasAttribute('data-xfm-muted')) {
        target.removeAttribute('data-xfm-muted');
      }
    }

    // ポストが差し替わって取り残された行を掃除する
    if (count === 0) {
      var stale = document.querySelectorAll('[data-xfm-muted="1"]');
      for (i = 0; i < stale.length; i++) stale[i].removeAttribute('data-xfm-muted');
    }

    mutedCount = count;
    updateBadge();
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try {
        apply();
      } catch (e) {
        console.error('[X Force Mute]', e);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * スタイル
   * ------------------------------------------------------------------ */
  function injectStyle() {
    if (document.getElementById('xfm-style')) return;
    var style = document.createElement('style');
    style.id = 'xfm-style';
    style.textContent = [
      '[data-xfm-muted="1"]{display:none !important;}',
      '.xfm-root{position:fixed;left:16px;bottom:16px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;}',
      '.xfm-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(127,127,127,.5);background:rgba(255,255,255,.92);color:inherit;font-size:22px;line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:0;transition:transform .12s ease;}',
      '.xfm-btn:hover{transform:scale(1.08);}',
      '.xfm-btn[data-active="1"]{border-color:#1d9bf0;box-shadow:0 0 0 2px rgba(29,155,240,.35),0 2px 8px rgba(0,0,0,.25);}',
      '.xfm-panel{position:absolute;left:0;bottom:56px;width:380px;max-width:calc(100vw - 32px);max-height:min(70vh,560px);display:none;flex-direction:column;gap:8px;background:#fff;color:#0f1419;border:1px solid rgba(127,127,127,.4);border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:14px;box-sizing:border-box;}',
      '.xfm-panel[data-open="1"]{display:flex;}',
      '.xfm-title{font-size:15px;font-weight:700;margin:0;}',
      '.xfm-help{font-size:11px;line-height:1.6;margin:0;opacity:.7;white-space:pre-line;}',
      '.xfm-textarea{flex:1 1 auto;min-height:200px;resize:vertical;box-sizing:border-box;width:100%;padding:8px;border:1px solid rgba(127,127,127,.5);border-radius:8px;background:transparent;color:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:13px;line-height:1.5;}',
      '.xfm-textarea:focus{outline:2px solid #1d9bf0;outline-offset:-1px;}',
      '.xfm-status{font-size:11px;opacity:.7;margin:0;}',
      '.xfm-footer{display:flex;justify-content:flex-end;gap:8px;}',
      '.xfm-action{padding:7px 16px;border-radius:9999px;border:1px solid rgba(127,127,127,.5);background:transparent;color:inherit;font-size:13px;font-weight:700;cursor:pointer;}',
      '.xfm-action.xfm-primary{background:#1d9bf0;border-color:#1d9bf0;color:#fff;}',
      '.xfm-action:hover{opacity:.85;}',
      '@media (prefers-color-scheme: dark){',
      '.xfm-btn{background:rgba(21,32,43,.92);color:#e7e9ea;}',
      '.xfm-panel{background:#15202b;color:#e7e9ea;}',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * 設定 UI
   * ------------------------------------------------------------------ */
  var ui = null;

  function updateBadge() {
    if (!ui) return;
    ui.button.setAttribute('data-active', hasAnyRule() ? '1' : '0');
    ui.button.title = 'Force Mute' + (mutedCount ? ' — ' + mutedCount + ' 件を非表示中' : '');
    if (ui.panel.getAttribute('data-open') === '1') {
      ui.status.textContent = 'このページで ' + mutedCount + ' 件のポストを非表示中';
    }
  }

  function isOpen() {
    return !!ui && ui.panel.getAttribute('data-open') === '1';
  }

  function openPanel() {
    ui.textarea.value = loadRaw();
    ui.panel.setAttribute('data-open', '1');
    updateBadge();
    ui.textarea.focus();
  }

  function closePanel() {
    ui.panel.setAttribute('data-open', '0');
  }

  function commit() {
    var text = ui.textarea.value;
    saveRaw(text);
    rules = parseRules(text);
    closePanel();
    apply();
  }

  function buildUI() {
    var root = document.createElement('div');
    root.className = 'xfm-root';

    var panel = document.createElement('div');
    panel.className = 'xfm-panel';
    panel.setAttribute('data-open', '0');

    var title = document.createElement('p');
    title.className = 'xfm-title';
    title.textContent = '🙈 Force Mute';

    var help = document.createElement('p');
    help.className = 'xfm-help';
    help.textContent =
      '1 行に 1 つずつ指定します。\n' +
      '  @screen_name … その人のポスト / リポスト / 引用元にマッチ\n' +
      '  /正規表現/ … 本文に正規表現でマッチ (フラグ省略時は i)\n' +
      '  それ以外 … 本文に部分一致 (大文字小文字は無視)';

    var textarea = document.createElement('textarea');
    textarea.className = 'xfm-textarea';
    textarea.spellcheck = false;
    textarea.placeholder = '@spam_user\n@another_user\nうざいキーワード\n/(?:速報|拡散希望)/';

    var status = document.createElement('p');
    status.className = 'xfm-status';

    var footer = document.createElement('div');
    footer.className = 'xfm-footer';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'xfm-action';
    cancel.textContent = 'Cancel';

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'xfm-action xfm-primary';
    save.textContent = 'Save';

    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(title);
    panel.appendChild(help);
    panel.appendChild(textarea);
    panel.appendChild(status);
    panel.appendChild(footer);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'xfm-btn';
    button.textContent = '🙈';
    button.setAttribute('aria-label', 'Force Mute の設定');

    root.appendChild(panel);
    root.appendChild(button);

    button.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (isOpen()) closePanel();
      else openPanel();
    });
    cancel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closePanel();
    });
    save.addEventListener('click', function (ev) {
      ev.stopPropagation();
      commit();
    });
    panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
    panel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        closePanel();
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.stopPropagation();
        commit();
      }
    });

    ui = {
      root: root,
      panel: panel,
      button: button,
      textarea: textarea,
      status: status
    };
    return root;
  }

  function mountUI() {
    if (!ui) buildUI();
    if (!ui.root.isConnected && document.body) document.body.appendChild(ui.root);
  }

  /* ------------------------------------------------------------------ *
   * 起動
   * ------------------------------------------------------------------ */
  function start() {
    injectStyle();
    rules = parseRules(loadRaw());
    mountUI();
    apply();

    new MutationObserver(function () {
      mountUI();
      schedule();
    }).observe(document.body, { childList: true, subtree: true });

    // SPA のページ遷移
    window.addEventListener('popstate', schedule);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
