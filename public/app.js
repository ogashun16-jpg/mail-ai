// app.js - Mail AI フロントエンド
// IPC: サーバー(server.js)とfetchで通信

// ===== State =====
const state = {
  user: null,
  folders: [],
  currentFolderPath: 'INBOX',
  currentFolderType: 'inbox',
  messages: [],
  selectedMessage: null,
  selectedMessageDetail: null,
  composeLang: 'ja',
  replyTo: null,
  isSyncing: false
};

// ===== Service Worker登録 =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ===== ユーティリティ =====
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.detail = data.detail;
    throw err;
  }
  return data;
}

function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (type === 'error' ? ' error' : '');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function formatTime(date) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== ログイン =====
async function checkAuth() {
  try {
    const res = await api('/api/me');
    if (res.loggedIn) {
      state.user = { emailAddress: res.emailAddress };
      showApp();
      await initialize();
    }
  } catch {}
}

async function login() {
  const btn = document.getElementById('loginBtn');
  const errBox = document.getElementById('loginError');
  errBox.innerHTML = '';
  btn.disabled = true;
  btn.textContent = '接続確認中…';

  const body = {
    emailAddress: document.getElementById('loginEmail').value.trim(),
    password: document.getElementById('loginPassword').value,
    imapHost: document.getElementById('imapHost').value.trim(),
    imapPort: document.getElementById('imapPort').value,
    imapSSL: document.getElementById('imapSSL').value === 'true',
    smtpHost: document.getElementById('smtpHost').value.trim(),
    smtpPort: document.getElementById('smtpPort').value,
    smtpSSL: document.getElementById('smtpSSL').value === 'true'
  };

  try {
    const res = await api('/api/login', { method: 'POST', body: JSON.stringify(body) });
    state.user = { emailAddress: res.emailAddress };
    showApp();
    await initialize();
  } catch (err) {
    errBox.innerHTML = `<div class="error-msg"><strong>ログイン失敗:</strong> ${escapeHtml(err.message)}${err.detail ? '<br><small>' + escapeHtml(err.detail) + '</small>' : ''}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

async function logout() {
  if (!confirm('ログアウトしますか？')) return;
  await api('/api/logout', { method: 'POST' });
  location.reload();
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('shown');

  const email = state.user.emailAddress;
  document.getElementById('accountEmail').textContent = email;
  document.getElementById('accountName').textContent = email.split('@')[0];
  document.getElementById('accountAvatar').textContent = email.charAt(0).toUpperCase();
}

// ===== 初期化 =====
async function initialize() {
  try {
    const res = await api('/api/folders');
    state.folders = res.folders;
    renderSidebar();
    await loadFolder('INBOX', 'inbox');
  } catch (err) {
    toast('フォルダ取得エラー: ' + err.message, 'error');
  }
}

// ===== サイドバー描画 =====
function renderSidebar() {
  const standardOrder = ['inbox', 'sent', 'drafts', 'spam', 'archive', 'trash'];
  const folderIcons = {
    inbox: '📥', sent: '📤', drafts: '📝',
    spam: '🚫', archive: '📦', trash: '🗑', custom: '📁'
  };
  const folderLabels = {
    inbox: '受信箱', sent: '送信済み', drafts: '下書き',
    spam: '迷惑メール', archive: 'アーカイブ', trash: 'ゴミ箱'
  };

  // 標準フォルダ
  const standardFolders = [];
  for (const type of standardOrder) {
    const folder = state.folders.find(f => f.type === type);
    if (folder) {
      standardFolders.push({
        path: folder.path,
        type: type,
        label: folderLabels[type] || folder.name,
        icon: folderIcons[type] || '📁'
      });
    }
  }
  // INBOXが見つからない場合は強制追加
  if (!standardFolders.find(f => f.type === 'inbox')) {
    standardFolders.unshift({ path: 'INBOX', type: 'inbox', label: '受信箱', icon: '📥' });
  }

  // カスタム
  const custom = state.folders.filter(f => f.type === 'custom' && !f.path.startsWith('INBOX'));

  const html = standardFolders.map(f => `
    <div class="nav-item ${f.path === state.currentFolderPath ? 'active' : ''}"
         onclick="loadFolder('${escapeHtml(f.path)}', '${f.type}')">
      <span class="nav-icon">${f.icon}</span>
      <span class="nav-label">${f.label}</span>
    </div>
  `).join('') + (custom.length > 0 ? `
    <div class="section-label">その他</div>
    ${custom.map(f => `
      <div class="nav-item ${f.path === state.currentFolderPath ? 'active' : ''}"
           onclick="loadFolder('${escapeHtml(f.path)}', 'custom')">
        <span class="nav-icon">📁</span>
        <span class="nav-label">${escapeHtml(f.name)}</span>
      </div>
    `).join('')}
  ` : '');

  document.getElementById('folderList').innerHTML = html;
}

// ===== フォルダ読み込み =====
async function loadFolder(path, type) {
  state.currentFolderPath = path;
  state.currentFolderType = type;
  state.selectedMessage = null;
  state.selectedMessageDetail = null;
  renderSidebar();

  // タイトル更新
  const labels = { inbox: '受信箱', sent: '送信済み', drafts: '下書き', spam: '迷惑メール', archive: 'アーカイブ', trash: 'ゴミ箱', custom: path };
  document.getElementById('listTitle').textContent = labels[type] || path;

  document.getElementById('listScroll').innerHTML = '<div class="list-empty">📥 読み込み中…</div>';
  document.getElementById('listSubtitle').innerHTML = '<span class="dot syncing"></span> 同期中…';

  // スマホ・小型タブレットでフォルダ選択時はリストペインを表示
  if (window.innerWidth <= 700) showPane('listPane');

  await refreshList();
}

async function refreshList() {
  if (state.isSyncing) return;
  state.isSyncing = true;
  document.getElementById('listSubtitle').innerHTML = '<span class="dot syncing"></span> 同期中…';

  try {
    const res = await api(`/api/messages?folder=${encodeURIComponent(state.currentFolderPath)}&limit=50`);
    state.messages = res.messages;
    renderMessageList();
    document.getElementById('listSubtitle').innerHTML = `<span class="dot"></span> ${res.total}件 · 同期完了`;
  } catch (err) {
    document.getElementById('listScroll').innerHTML = `<div class="list-empty" style="color:var(--warn);">⚠️ ${escapeHtml(err.message)}</div>`;
    document.getElementById('listSubtitle').innerHTML = '<span class="dot" style="background:var(--warn);"></span> エラー';
  } finally {
    state.isSyncing = false;
  }
}

function renderMessageList() {
  if (state.messages.length === 0) {
    document.getElementById('listScroll').innerHTML = '<div class="list-empty">📭 このフォルダにメールはありません</div>';
    return;
  }

  const isSentFolder = state.currentFolderType === 'sent' || state.currentFolderType === 'drafts';

  const html = state.messages.map(m => {
    const fromText = isSentFolder
      ? '宛先: ' + (m.to[0]?.name || m.to[0]?.address || '(未指定)')
      : (m.from.name || m.from.address || '(送信者不明)');

    const tags = [];
    if (m.hasAttachment) tags.push('<span class="tag attach">📎</span>');
    if (state.currentFolderType === 'spam') tags.push('<span class="tag" style="background:#ffe0d6;color:#b53f0f;">⚠ 高リスク</span>');

    return `
      <div class="mail-item ${!m.isSeen ? 'unread' : ''} ${state.selectedMessage?.uid === m.uid ? 'selected' : ''}"
           onclick="openMessage(${m.uid})">
        <div class="mail-row">
          <div class="mail-from">${escapeHtml(fromText)}</div>
          <div class="mail-time">${formatTime(m.date)}</div>
        </div>
        <div class="mail-subject">${escapeHtml(m.subject || '(件名なし)')}</div>
        ${tags.length > 0 ? `<div class="mail-tags">${tags.join('')}</div>` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('listScroll').innerHTML = html;
}

// ===== メール詳細 =====
async function openMessage(uid) {
  const msg = state.messages.find(m => m.uid === uid);
  if (!msg) return;

  state.selectedMessage = msg;
  renderMessageList();  // 選択状態反映
  // iPad縦/スマホでは詳細ペインをオーバーレイ表示
  if (window.innerWidth <= 900) showPane('detailPane');

  document.getElementById('detailEmpty').style.display = 'none';
  document.getElementById('detailContent').style.display = 'flex';
  document.getElementById('detailContent').innerHTML = '<div class="detail-empty">読み込み中…</div>';

  try {
    const detail = await api(`/api/message/${uid}?folder=${encodeURIComponent(state.currentFolderPath)}`);
    state.selectedMessageDetail = detail;
    renderMessageDetail(detail);
    msg.isSeen = true;
    renderMessageList();
  } catch (err) {
    document.getElementById('detailContent').innerHTML = `<div class="detail-empty" style="color:var(--warn);">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

function renderMessageDetail(detail) {
  const isSpam = state.currentFolderType === 'spam';
  const senderName = detail.from.name || detail.from.address || '(送信者不明)';
  const senderInit = senderName.charAt(0).toUpperCase();
  const bodyText = detail.bodyText || (detail.bodyHtml ? stripHtml(detail.bodyHtml) : '(本文なし)');

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-actions">
      <div class="action-group">
        <button class="action-btn back-btn" onclick="exitFullscreenAndBack()">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 4 6 8l4 4"/></svg>
        </button>
        <button class="action-btn" onclick="replyMessage()">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 4 5 8l4 4M5 8h7"/></svg>
          返信
        </button>
        <button class="action-btn" onclick="forwardMessage()">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 4l4 4-4 4M11 8H4"/></svg>
          転送
        </button>
      </div>
      <div class="action-group">
        <button class="action-btn fullscreen-toggle" onclick="toggleFullscreen(true)" title="全画面表示">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        </button>
        <button class="action-btn fullscreen-toggle exit" onclick="toggleFullscreen(false)" title="全画面を解除">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>
        </button>
        ${isSpam ? '' : `<button class="action-btn" onclick="moveToSpam()" title="迷惑メールへ">🚫</button>`}
        <button class="action-btn" onclick="deleteMessage()" title="削除">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h10M5 4v10c0 1 .5 1.5 1.5 1.5h3c1 0 1.5-.5 1.5-1.5V4M6 4V2.5C6 2 6.2 2 7 2h2c.8 0 1 0 1 .5V4"/></svg>
        </button>
      </div>
    </div>

    <div class="detail-scroll">
      ${isSpam ? `
        <div class="spam-banner">
          <div class="spam-banner-icon">!</div>
          <div>
            <div class="spam-banner-title">このメールは迷惑メールフォルダにあります</div>
            フィッシングや詐欺の可能性があります。リンクや添付ファイルには注意してください。
            <div class="spam-actions">
              <button class="spam-action-btn primary" onclick="moveBackToInbox()">受信箱へ移動</button>
              <button class="spam-action-btn" onclick="deleteMessage()">完全に削除</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="mail-header">
        <h2 class="mail-title">${escapeHtml(detail.subject || '(件名なし)')}</h2>
        <div class="sender-row">
          <div class="sender-avatar">${escapeHtml(senderInit)}</div>
          <div class="sender-info">
            <div class="sender-name">${escapeHtml(senderName)}</div>
            <div class="sender-email">${escapeHtml(detail.from.address || '')}</div>
            <div class="sender-meta">宛先: ${escapeHtml((detail.to.map(t => t.name || t.address).join(', ')) || '(なし)')}</div>
          </div>
          <div class="mail-time-right">${formatTime(detail.date)}</div>
        </div>
      </div>

      <div class="ai-card" id="aiCard">
        <div class="ai-header">
          <div class="ai-title">
            <div class="ai-pulse"></div>
            CLAUDE 日本語要約
          </div>
        </div>
        <div class="ai-body" id="aiBody">
          <button class="ai-trigger" onclick="generateSummary()">
            ✨ 日本語で要約する
          </button>
        </div>
      </div>

      ${detail.attachments && detail.attachments.length > 0 ? `
        <div class="attachments-section">
          <div class="attachments-label">📎 添付ファイル (${detail.attachments.length})</div>
          <div class="attachments-grid">
            ${detail.attachments.map((a, idx) => {
              const ext = (a.filename || '').split('.').pop().toUpperCase().substring(0, 4);
              const isImage = (a.contentType || '').startsWith('image/');
              const isPdf = (a.contentType || '') === 'application/pdf';
              const canPreview = isImage || isPdf;
              const sizeKB = Math.round((a.size || 0) / 1024);
              const sizeDisplay = sizeKB > 1024 ? `${(sizeKB/1024).toFixed(1)} MB` : `${sizeKB} KB`;
              return `
                <div class="attachment-card">
                  <div class="attachment-icon ${isImage ? 'image' : isPdf ? 'pdf' : ''}">${ext || '📄'}</div>
                  <div class="attachment-info">
                    <div class="attachment-name" title="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</div>
                    <div class="attachment-size">${sizeDisplay}</div>
                  </div>
                  <div class="attachment-actions">
                    ${canPreview ? `<button class="attach-action-btn" onclick="previewAttachment(${detail.uid}, ${idx}, '${escapeHtml(a.contentType)}', '${escapeHtml(a.filename).replace(/'/g, "\\'")}')" title="プレビュー">👁</button>` : ''}
                    <button class="attach-action-btn" onclick="downloadAttachment(${detail.uid}, ${idx}, '${escapeHtml(a.filename).replace(/'/g, "\\'")}')" title="ダウンロード">⬇</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="mail-body">${escapeHtml(bodyText).replace(/\n/g, '<br>')}</div>
    </div>
  `;
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

// ===== 添付ファイル =====
function downloadAttachment(uid, idx, filename) {
  const url = `/api/message/${uid}/attachment/${idx}?folder=${encodeURIComponent(state.currentFolderPath)}&disposition=attachment`;
  // 一時的なリンクを作成して自動クリック
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
  toast(`「${filename}」をダウンロード中…`);
}

function previewAttachment(uid, idx, contentType, filename) {
  const url = `/api/message/${uid}/attachment/${idx}?folder=${encodeURIComponent(state.currentFolderPath)}&disposition=inline`;
  const isImage = (contentType || '').startsWith('image/');
  const isPdf = (contentType || '') === 'application/pdf';

  const modal = document.getElementById('previewModal');
  const content = document.getElementById('previewContent');
  const title = document.getElementById('previewTitle');

  title.textContent = filename;

  if (isImage) {
    content.innerHTML = `<img src="${url}" alt="${escapeHtml(filename)}" style="max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;">`;
  } else if (isPdf) {
    content.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:none;background:white;"></iframe>`;
  } else {
    // 他のファイル形式は新規タブで開く
    window.open(url, '_blank');
    return;
  }

  modal.classList.add('open');
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.classList.remove('open');
  document.getElementById('previewContent').innerHTML = '';
}

function downloadFromPreview() {
  // プレビュー中のファイルをダウンロード
  const url = document.querySelector('#previewContent img, #previewContent iframe')?.src;
  const filename = document.getElementById('previewTitle').textContent;
  if (url) {
    // 同じURLでdispositionだけ変更
    const downloadUrl = url.replace('disposition=inline', 'disposition=attachment');
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }
}

// ===== AI 要約 =====
async function generateSummary() {
  const body = document.getElementById('aiBody');
  body.innerHTML = `
    <div class="ai-loading">
      <span class="ai-loading-dot"></span>
      <span class="ai-loading-dot"></span>
      <span class="ai-loading-dot"></span>
      <div style="margin-top:12px;">Claude が要約を生成中…</div>
    </div>
  `;

  try {
    const detail = state.selectedMessageDetail;
    const bodyContent = detail.bodyText || stripHtml(detail.bodyHtml || '');
    const res = await api('/api/ai/summarize', {
      method: 'POST',
      body: JSON.stringify({
        subject: detail.subject,
        from: `${detail.from.name || ''} <${detail.from.address}>`,
        body: bodyContent,
        language: 'ja'
      })
    });

    body.innerHTML = `
      <div class="ai-summary-text">${escapeHtml(res.summary).replace(/\n/g, '<br>')}</div>
      <div class="ai-actions">
        <button class="ai-mini-btn" onclick="generateSummary()">再要約</button>
        <button class="ai-mini-btn" onclick="replyMessage(true)">✨ AI返信を作成</button>
      </div>
    `;
    // モデル名を更新
    document.querySelector('.ai-header').insertAdjacentHTML('beforeend',
      `<div class="ai-model">${res.model || ''}</div>`);
  } catch (err) {
    body.innerHTML = `<div class="ai-error">⚠️ ${escapeHtml(err.message)}</div>
      <button class="ai-trigger" onclick="generateSummary()" style="margin-top:10px;">再試行</button>`;
  }
}

// ===== 操作（返信・削除・移動） =====
function replyMessage(withAI = false) {
  state.replyTo = state.selectedMessageDetail;
  openCompose();
  document.getElementById('composeTitle').textContent = '返信を作成';
  document.getElementById('composeTo').value = state.replyTo.from.address;
  document.getElementById('composeSubject').value = state.replyTo.subject?.startsWith('Re:') ? state.replyTo.subject : `Re: ${state.replyTo.subject}`;
  if (withAI) {
    setTimeout(() => promptInstruction(), 300);
  }
}

function forwardMessage() {
  state.replyTo = null;
  openCompose();
  document.getElementById('composeTitle').textContent = '転送';
  document.getElementById('composeSubject').value = `Fwd: ${state.selectedMessageDetail.subject}`;
  const original = state.selectedMessageDetail;
  document.getElementById('composeBody').value = `\n\n---------- 転送メッセージ ----------\nFrom: ${original.from.name} <${original.from.address}>\nDate: ${new Date(original.date).toLocaleString('ja-JP')}\nSubject: ${original.subject}\n\n${original.bodyText || stripHtml(original.bodyHtml || '')}`;
}

async function deleteMessage() {
  if (!confirm('このメールを削除しますか？')) return;
  const m = state.selectedMessage;
  const trash = state.folders.find(f => f.type === 'trash');
  try {
    if (trash && state.currentFolderType !== 'trash') {
      await api(`/api/message/${m.uid}/move`, {
        method: 'POST',
        body: JSON.stringify({ from: state.currentFolderPath, to: trash.path })
      });
    } else {
      await api(`/api/message/${m.uid}/flag`, {
        method: 'POST',
        body: JSON.stringify({ folder: state.currentFolderPath, flag: 'Deleted', action: 'add' })
      });
    }
    toast('削除しました');
    state.selectedMessage = null;
    document.getElementById('detailContent').style.display = 'none';
    document.getElementById('detailEmpty').style.display = 'flex';
    await refreshList();
  } catch (err) {
    toast('削除エラー: ' + err.message, 'error');
  }
}

async function moveToSpam() {
  const spam = state.folders.find(f => f.type === 'spam');
  if (!spam) return toast('迷惑メールフォルダが見つかりません', 'error');
  try {
    await api(`/api/message/${state.selectedMessage.uid}/move`, {
      method: 'POST',
      body: JSON.stringify({ from: state.currentFolderPath, to: spam.path })
    });
    toast('迷惑メールへ移動しました');
    state.selectedMessage = null;
    document.getElementById('detailContent').style.display = 'none';
    document.getElementById('detailEmpty').style.display = 'flex';
    await refreshList();
  } catch (err) {
    toast('移動エラー: ' + err.message, 'error');
  }
}

async function moveBackToInbox() {
  const inbox = state.folders.find(f => f.type === 'inbox') || { path: 'INBOX' };
  try {
    await api(`/api/message/${state.selectedMessage.uid}/move`, {
      method: 'POST',
      body: JSON.stringify({ from: state.currentFolderPath, to: inbox.path })
    });
    toast('受信箱へ移動しました');
    state.selectedMessage = null;
    document.getElementById('detailContent').style.display = 'none';
    document.getElementById('detailEmpty').style.display = 'flex';
    await refreshList();
  } catch (err) {
    toast('移動エラー: ' + err.message, 'error');
  }
}

// ===== 作成 =====
function openCompose() {
  document.getElementById('composeModal').classList.add('open');
  if (!state.replyTo) {
    document.getElementById('composeTitle').textContent = '新規メール';
    document.getElementById('composeTo').value = '';
    document.getElementById('composeSubject').value = '';
    document.getElementById('composeBody').value = '';
  }
}

function closeCompose() {
  if (document.getElementById('composeBody').value.trim() && !confirm('破棄しますか？')) return;
  document.getElementById('composeModal').classList.remove('open');
  state.replyTo = null;
}

function setLang(lang) {
  state.composeLang = lang;
  document.querySelectorAll('.lang-option').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

function promptInstruction() {
  const isReply = !!state.replyTo;
  const instruction = prompt(
    isReply
      ? 'どのような返信にしますか？\n例: 「快諾して火曜の14時を提案」「もう少し時間が欲しいと伝える」'
      : 'メールの内容を簡潔に教えてください\n例: 「来週の打ち合わせ日程について確認」',
    ''
  );
  if (instruction === null) return;
  generateDraft(instruction);
}

async function generateDraft(instruction) {
  const thinking = document.getElementById('aiThinking');
  const editor = document.getElementById('composeBody');
  thinking.classList.add('show');
  editor.value = '';

  try {
    const body = {
      mode: state.replyTo ? 'reply' : 'new',
      language: state.composeLang,
      tone: document.getElementById('composeTone').value,
      instruction
    };
    if (state.replyTo) {
      body.originalSubject = state.replyTo.subject;
      body.originalFrom = `${state.replyTo.from.name || ''} <${state.replyTo.from.address}>`;
      body.originalBody = state.replyTo.bodyText || stripHtml(state.replyTo.bodyHtml || '');
    } else {
      body.recipient = document.getElementById('composeTo').value;
    }

    const res = await api('/api/ai/draft', { method: 'POST', body: JSON.stringify(body) });
    thinking.classList.remove('show');

    // ストリーミング風表示
    let i = 0;
    const text = res.draft;
    const interval = setInterval(() => {
      editor.value = text.slice(0, i);
      editor.scrollTop = editor.scrollHeight;
      i += 3;
      if (i >= text.length) {
        editor.value = text;
        clearInterval(interval);
      }
    }, 12);
  } catch (err) {
    thinking.classList.remove('show');
    toast('AI生成エラー: ' + err.message, 'error');
  }
}

// ===== 送信 =====
async function sendMail() {
  const to = document.getElementById('composeTo').value.trim();
  const subject = document.getElementById('composeSubject').value.trim();
  const body = document.getElementById('composeBody').value;

  if (!to) return toast('宛先を入力してください', 'error');
  if (!body.trim()) return toast('本文を入力してください', 'error');

  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.textContent = '送信中…';

  try {
    await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({
        to: to.split(',').map(s => s.trim()),
        subject,
        body
      })
    });
    toast('✓ 送信完了');
    document.getElementById('composeModal').classList.remove('open');
    document.getElementById('composeBody').value = '';
    state.replyTo = null;
    // 送信済みフォルダなら更新
    if (state.currentFolderType === 'sent') refreshList();
  } catch (err) {
    toast('送信エラー: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '送信 <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8h9M8 4l4 4-4 4"/></svg>';
  }
}

// ===== フルスクリーン表示（メール本文を最大化） =====
function toggleFullscreen(enable) {
  const app = document.getElementById('app');
  if (enable) {
    app.classList.add('fullscreen-detail');
  } else {
    app.classList.remove('fullscreen-detail');
  }
}

// 戻るボタン: フルスクリーンを解除してからリストへ
function exitFullscreenAndBack() {
  document.getElementById('app').classList.remove('fullscreen-detail');
  showPane('listPane');
}

// ===== ペイン切替（iPad縦/iPhone用） =====
function showPane(paneId) {
  const w = window.innerWidth;

  // ペイン切替時はフルスクリーンを解除
  if (paneId !== 'detailPane') {
    document.getElementById('app').classList.remove('fullscreen-detail');
  }

  if (w <= 700) {
    // iPhone: 完全に1ペインずつ
    ['sidebar', 'listPane', 'detailPane'].forEach(id => {
      document.getElementById(id).classList.toggle('active-pane', id === paneId);
    });
  } else if (w <= 900) {
    // iPad縦: サイドバー+リストは常時表示、詳細はオーバーレイ
    const detailPane = document.getElementById('detailPane');
    if (paneId === 'detailPane') {
      detailPane.classList.add('active-pane');
    } else {
      detailPane.classList.remove('active-pane');
    }
  }
  // 大画面では何もしない（3ペイン同時表示）
}

// 画面回転・サイズ変更時にペイン状態をリセット
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  if (w > 900) {
    // 大画面に戻ったらactive-paneクラスを全部外す
    ['sidebar', 'listPane', 'detailPane'].forEach(id => {
      document.getElementById(id).classList.remove('active-pane');
    });
  } else if (w > 700 && w <= 900) {
    // iPad縦: sidebarとlistPaneは常時表示
    document.getElementById('sidebar').classList.remove('active-pane');
    document.getElementById('listPane').classList.remove('active-pane');
  }
});

// ===== APIキー設定モーダル =====
function showApiKeyModal() {
  document.getElementById('apiKeyModal').classList.add('open');
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Enter キーでログイン
  ['loginEmail', 'loginPassword'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') login();
    });
  });
});
