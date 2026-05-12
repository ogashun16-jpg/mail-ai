// server.js - Mail AI バックエンド（Render.com版）
// iPad → Render(Node.js) → mail.sritakada.com.my (IMAP/SMTP) + Claude API

import express from 'express';
import session from 'express-session';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

// ============================================================
// ミドルウェア
// ============================================================
// RenderはHTTPSターミネーションをプロキシで行うので必須
app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PROD,             // 本番はHTTPSのみ
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7日間
  }
}));

// ============================================================
// ヘルスチェック（Render監視 + UptimeRobot等のping用）
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ============================================================
// IMAP接続
// ============================================================
function makeImapClient(creds) {
  return new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSSL,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    tls: { rejectUnauthorized: false }
  });
}

function requireAuth(req, res, next) {
  if (!req.session.creds) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  next();
}

// ============================================================
// API: ログイン / ログアウト
// ============================================================
app.post('/api/login', async (req, res) => {
  const {
    emailAddress, password,
    imapHost = 'mail.sritakada.com.my',
    imapPort = 993,
    imapSSL = true,
    smtpHost = 'mail.sritakada.com.my',
    smtpPort = 465,
    smtpSSL = true
  } = req.body;

  if (!emailAddress || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードは必須です' });
  }

  const creds = {
    emailAddress,
    username: emailAddress,
    password,
    imapHost,
    imapPort: parseInt(imapPort),
    imapSSL,
    smtpHost,
    smtpPort: parseInt(smtpPort),
    smtpSSL
  };

  const client = makeImapClient(creds);
  try {
    await client.connect();
    await client.logout();
    req.session.creds = creds;
    res.json({ ok: true, emailAddress });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(401).json({
      error: 'ログインに失敗しました',
      detail: err.message
    });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.creds) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    emailAddress: req.session.creds.emailAddress
  });
});

// ============================================================
// フォルダ一覧
// ============================================================
app.get('/api/folders', requireAuth, async (req, res) => {
  const client = makeImapClient(req.session.creds);
  try {
    await client.connect();
    const folders = await client.list();
    await client.logout();

    const typed = folders.map(f => ({
      path: f.path,
      name: f.name,
      flags: Array.from(f.flags || []),
      type: inferFolderType(f.path, f.specialUse, Array.from(f.flags || []))
    }));

    res.json({ folders: typed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function inferFolderType(path, specialUse) {
  const p = path.toLowerCase();
  if (specialUse) {
    const s = specialUse.toLowerCase();
    if (s.includes('inbox')) return 'inbox';
    if (s.includes('sent')) return 'sent';
    if (s.includes('drafts')) return 'drafts';
    if (s.includes('junk')) return 'spam';
    if (s.includes('trash')) return 'trash';
    if (s.includes('archive')) return 'archive';
  }
  if (p === 'inbox') return 'inbox';
  if (p.includes('sent') || p.includes('送信')) return 'sent';
  if (p.includes('draft') || p.includes('下書き')) return 'drafts';
  if (p.includes('junk') || p.includes('spam') || p.includes('迷惑')) return 'spam';
  if (p.includes('trash') || p.includes('deleted') || p.includes('ゴミ')) return 'trash';
  if (p.includes('archive') || p.includes('アーカイブ')) return 'archive';
  return 'custom';
}

// ============================================================
// メール一覧
// ============================================================
app.get('/api/messages', requireAuth, async (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const client = makeImapClient(req.session.creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);

    try {
      const mailbox = client.mailbox;
      const total = mailbox.exists;
      if (total === 0) {
        return res.json({ messages: [], total: 0, folder });
      }

      const start = Math.max(1, total - limit + 1);
      const range = `${start}:${total}`;

      const messages = [];
      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        uid: true,
        bodyStructure: true,
        internalDate: true
      })) {
        const env = msg.envelope || {};
        const flags = Array.from(msg.flags || []);
        messages.push({
          uid: msg.uid,
          seq: msg.seq,
          subject: env.subject || '(件名なし)',
          from: env.from?.[0] || { name: '', address: '' },
          to: env.to || [],
          cc: env.cc || [],
          date: env.date || msg.internalDate,
          isSeen: flags.includes('\\Seen'),
          isFlagged: flags.includes('\\Flagged'),
          isAnswered: flags.includes('\\Answered'),
          hasAttachment: detectAttachment(msg.bodyStructure)
        });
      }

      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json({ messages, total, folder });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('Fetch error:', err);
    try { await client.logout(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

function detectAttachment(structure) {
  if (!structure) return false;
  if (structure.disposition === 'attachment') return true;
  if (structure.childNodes) return structure.childNodes.some(detectAttachment);
  return false;
}

// ============================================================
// メール本文
// ============================================================
app.get('/api/message/:uid', requireAuth, async (req, res) => {
  const uid = parseInt(req.params.uid);
  const folder = req.query.folder || 'INBOX';

  const client = makeImapClient(req.session.creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);

    try {
      const { content } = await client.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);

      await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });

      res.json({
        uid,
        subject: parsed.subject,
        from: parsed.from?.value?.[0] || {},
        to: parsed.to?.value || [],
        cc: parsed.cc?.value || [],
        date: parsed.date,
        bodyText: parsed.text || '',
        bodyHtml: parsed.html || '',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size
        }))
      });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// メール送信
// ============================================================
app.post('/api/send', requireAuth, async (req, res) => {
  const { to, cc, bcc, subject, body, isHtml = false } = req.body;
  const creds = req.session.creds;

  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpSSL,
    auth: { user: creds.username, pass: creds.password },
    tls: { rejectUnauthorized: false }
  });

  try {
    const info = await transporter.sendMail({
      from: creds.emailAddress,
      to, cc, bcc, subject,
      [isHtml ? 'html' : 'text']: body
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// フラグ操作・移動
// ============================================================
app.post('/api/message/:uid/flag', requireAuth, async (req, res) => {
  const uid = parseInt(req.params.uid);
  const { folder = 'INBOX', flag, action } = req.body;

  const client = makeImapClient(req.session.creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const fullFlag = `\\${flag}`;
      if (action === 'add') {
        await client.messageFlagsAdd({ uid }, [fullFlag], { uid: true });
      } else {
        await client.messageFlagsRemove({ uid }, [fullFlag], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
    res.json({ ok: true });
  } catch (err) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/message/:uid/move', requireAuth, async (req, res) => {
  const uid = parseInt(req.params.uid);
  const { from, to } = req.body;

  const client = makeImapClient(req.session.creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(from);
    try {
      await client.messageMove({ uid }, to, { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    res.json({ ok: true });
  } catch (err) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Claude AI - 要約
// ============================================================
app.post('/api/ai/summarize', requireAuth, async (req, res) => {
  const { subject, from, body, language = 'ja' } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEYが未設定です' });
  }

  let cleanBody = (body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanBody.length > 10000) {
    cleanBody = cleanBody.substring(0, 5000) + '\n\n...[中略]...\n\n' + cleanBody.substring(cleanBody.length - 5000);
  }

  const langName = language === 'en' ? '英語' : '日本語';
  const systemPrompt = `あなたはビジネスメールの要約アシスタントです。以下のメール本文を${langName}で要約してください。出力形式:

【要点】
・1〜3項目で核心を箇条書き

【相手の依頼／質問】
・なければ「特になし」

【期限・日時】
・明示されているもののみ抽出

【推奨アクション】
・返信が必要か、いつまでに何をすべきか

必ず${langName}で出力してください。`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: `件名: ${subject}\n送信者: ${from}\n\n本文:\n${cleanBody}` }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Claude APIエラー' });
    }

    res.json({
      summary: data.content.map(c => c.text).join('\n'),
      usage: data.usage,
      model: data.model
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Claude AI - 下書き
// ============================================================
app.post('/api/ai/draft', requireAuth, async (req, res) => {
  const {
    mode = 'reply',
    originalSubject = '',
    originalFrom = '',
    originalBody = '',
    instruction = '',
    language = 'ja',
    tone = 'polite',
    recipient = ''
  } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEYが未設定です' });
  }

  const langInstruction = {
    ja: '必ず日本語で出力してください。',
    en: 'Always respond in English.',
    auto: '受信メールの言語を判定し、同じ言語で出力してください。'
  }[language] || '';

  const toneMap = {
    formal: 'フォーマル（敬語、形式的）',
    polite: '丁寧（ビジネス標準）',
    concise: '簡潔（短く要点のみ）',
    casual: 'カジュアル（親しみやすく）'
  };

  let systemPrompt, userText;
  if (mode === 'reply') {
    systemPrompt = `あなたはメール下書きアシスタントです。返信メールの本文のみを出力してください（説明文や前置きは不要）。

- 言語ルール: ${langInstruction}
- トーン: ${toneMap[tone] || tone}
- 元メールの文脈を踏まえ、自然で実用的な返信を作成
- 署名は含めない（ユーザーが後で追加）`;

    const cleanBody = originalBody.replace(/<[^>]+>/g, ' ').substring(0, 5000);
    userText = `【受信メール】
件名: ${originalSubject}
送信者: ${originalFrom}

本文:
${cleanBody}

【ユーザーの返信意図】
${instruction || '適切に返信してください'}`;
  } else {
    systemPrompt = `あなたはメール下書きアシスタントです。本文のみを出力してください（件名や説明文は不要）。
トーン: ${toneMap[tone] || tone} / 言語: ${langInstruction}
署名は含めません。`;
    userText = `宛先: ${recipient}\n伝えたい内容: ${instruction}`;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Claude APIエラー' });
    }

    res.json({
      draft: data.content.map(c => c.text).join('\n'),
      usage: data.usage,
      model: data.model
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 起動
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📧 Mail AI サーバー起動: port ${PORT}`);
  console.log(`   環境: ${IS_PROD ? 'production' : 'development'}`);
  console.log(`   ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'} ANTHROPIC_API_KEY`);
  console.log(`   ${process.env.SESSION_SECRET ? '✓' : '✗'} SESSION_SECRET\n`);
});
