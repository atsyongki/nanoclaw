/**
 * Telegram channel adapter (v2).
 *
 * Uses the Bot API's long-polling getUpdates loop — no webhooks, no grammy.
 * Env vars (read inside setup(), not at module load):
 *   TELEGRAM_BOT_TOKEN      — required
 *   ALLOWED_TELEGRAM_CHATS  — optional comma-separated chat IDs; allow all if unset
 *   TELEGRAM_API_ROOT       — optional custom Bot API server root (default: https://api.telegram.org)
 */

import { log } from '../log.js';
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';

// ── Telegram API types ────────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  reply_to_message?: TelegramMessage;
  message_thread_id?: number;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: { file_id: string };
  audio?: { file_id: string; file_name?: string };
  video?: { file_id: string };
  sticker?: { file_id: string; emoji?: string };
  location?: { latitude: number; longitude: number };
  contact?: { phone_number: string; first_name: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

// ── Error ─────────────────────────────────────────────────────────────────────

class TelegramApiError extends Error {
  constructor(
    public readonly code: number,
    description: string,
    public readonly retryAfter?: number,
  ) {
    super(description);
    this.name = 'TelegramApiError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function isImageFilename(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTS.has(filename.slice(dot).toLowerCase());
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class TelegramAdapter implements ChannelAdapter {
  name = 'telegram';
  channelType = 'telegram';
  supportsThreads = false;

  private readonly token: string;
  private baseUrl = '';
  private botUsername = '';
  private polling = false;
  private nextUpdateId = 0;
  private allowedChats = new Set<string>();

  constructor(token: string) {
    this.token = token;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async setup(config: ChannelSetup): Promise<void> {
    const apiRoot = process.env.TELEGRAM_API_ROOT ?? 'https://api.telegram.org';
    this.baseUrl = `${apiRoot}/bot${this.token}`;

    const allowedStr = process.env.ALLOWED_TELEGRAM_CHATS ?? '';
    for (const id of allowedStr.split(',').map((s) => s.trim()).filter(Boolean)) {
      this.allowedChats.add(id);
    }

    // Ensure long-polling mode (drops any stale webhook).
    await this.callApi<Record<string, unknown>>('deleteWebhook', { drop_pending_updates: false });

    const me = await this.callApi<TelegramBotInfo>('getMe');
    this.botUsername = me.username ?? '';
    log.info('Telegram bot connected', { username: this.botUsername, id: me.id });

    // Register known allowed chats as metadata so the host can wire them.
    for (const chatId of this.allowedChats) {
      config.onMetadata(chatId, chatId, false);
    }

    this.polling = true;
    void this.pollLoop(config);
  }

  async teardown(): Promise<void> {
    this.polling = false;
    log.info('Telegram bot stopped');
  }

  isConnected(): boolean {
    return this.polling;
  }

  // ── Outbound ────────────────────────────────────────────────────────────────

  async deliver(
    platformId: string,
    _threadId: string | null,
    message: OutboundMessage,
  ): Promise<string | undefined> {
    // Deliver file attachments first (photos / documents)
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        try {
          const method = isImageFilename(file.filename) ? 'sendPhoto' : 'sendDocument';
          const fieldName = method === 'sendPhoto' ? 'photo' : 'document';
          const form = new FormData();
          form.set('chat_id', platformId);
          form.set(fieldName, new Blob([file.data]), file.filename);
          const resp = await fetch(`${this.baseUrl}/${method}`, { method: 'POST', body: form });
          const json = (await resp.json()) as TelegramApiResponse<Record<string, unknown>>;
          if (!json.ok) {
            log.warn('Telegram file send failed', { filename: file.filename, desc: json.description });
          }
        } catch (err) {
          log.warn('Telegram file send threw', { filename: file.filename, err });
        }
      }
    }

    const text = extractText(message.content);
    if (!text) return undefined;

    const MAX = 4096;
    try {
      if (text.length <= MAX) {
        await this.sendText(platformId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX) {
          await this.sendText(platformId, text.slice(i, i + MAX));
        }
      }
      log.info('Telegram message sent', { platformId, length: text.length });
    } catch (err) {
      log.error('Telegram deliver failed', { platformId, err });
    }
    return undefined;
  }

  async setTyping(platformId: string, _threadId: string | null): Promise<void> {
    try {
      await this.callApi('sendChatAction', { chat_id: platformId, action: 'typing' });
    } catch (err) {
      log.debug('Telegram typing indicator failed', { platformId, err });
    }
  }

  // ── Long-polling loop ───────────────────────────────────────────────────────

  private async pollLoop(config: ChannelSetup): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.callApi<TelegramUpdate[]>('getUpdates', {
          offset: this.nextUpdateId,
          timeout: 30,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          if (update.update_id >= this.nextUpdateId) {
            this.nextUpdateId = update.update_id + 1;
          }
          try {
            await this.processUpdate(update, config);
          } catch (err) {
            log.error('Telegram update processing error', { err, update_id: update.update_id });
          }
        }
      } catch (err) {
        if (!this.polling) break;
        if (err instanceof TelegramApiError && err.code === 429) {
          const wait = (err.retryAfter ?? 5) * 1000;
          log.warn('Telegram rate limited', { retryAfterMs: wait });
          await sleep(wait);
        } else {
          log.error('Telegram getUpdates error', { err });
          await sleep(5000);
        }
      }
    }
  }

  // ── Update processing ───────────────────────────────────────────────────────

  private async processUpdate(update: TelegramUpdate, config: ChannelSetup): Promise<void> {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat.id.toString();

    if (this.allowedChats.size > 0 && !this.allowedChats.has(chatId)) {
      log.debug('Telegram: message from unallowed chat ignored', { chatId });
      return;
    }

    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const chatName = isGroup
      ? (msg.chat.title ?? chatId)
      : msg.from?.first_name ?? msg.from?.username ?? chatId;
    config.onMetadata(chatId, chatName, isGroup);

    const timestamp = new Date(msg.date * 1000).toISOString();
    const senderName =
      msg.from?.first_name ?? msg.from?.username ?? msg.from?.id?.toString() ?? 'Unknown';
    const sender = msg.from?.id?.toString() ?? '';
    const msgId = msg.message_id.toString();

    // Reply quote context
    const replyTo = msg.reply_to_message;
    const replyQuoteContext = replyTo
      ? {
          reply_to_message_id: replyTo.message_id.toString(),
          reply_to_message_content: replyTo.text ?? replyTo.caption,
          reply_to_sender_name:
            replyTo.from?.first_name ?? replyTo.from?.username ?? replyTo.from?.id?.toString(),
        }
      : undefined;

    const threadId = msg.message_thread_id?.toString();

    // ── Parse message content ─────────────────────────────────────────────────
    let text: string | undefined;
    let isMention = false;

    if (msg.text !== undefined) {
      // Built-in bot commands — handle and skip from agent routing
      if (msg.text.startsWith('/')) {
        const cmd = msg.text.slice(1).split(/[\s@]/)[0]?.toLowerCase() ?? '';
        if (cmd === 'chatid') {
          await this.replyCommand(msg.chat.id, `Chat ID: \`${chatId}\`\nType: ${msg.chat.type}`);
          return;
        }
        if (cmd === 'ping') {
          await this.replyCommand(msg.chat.id, 'Bot is online.');
          return;
        }
      }

      text = msg.text;

      // Detect @botUsername mention and set isMention
      if (this.botUsername) {
        const lowerBot = `@${this.botUsername.toLowerCase()}`;
        isMention = (msg.entities ?? []).some((e) => {
          if (e.type !== 'mention') return false;
          return text!.substring(e.offset, e.offset + e.length).toLowerCase() === lowerBot;
        });
      }
    } else if (msg.photo) {
      const caption = msg.caption ? ` ${msg.caption}` : '';
      text = `[Photo]${caption}`;
    } else if (msg.document) {
      const name = msg.document.file_name ?? 'file';
      const caption = msg.caption ? ` ${msg.caption}` : '';
      text = `[Document: ${name}]${caption}`;
    } else if (msg.voice) {
      text = '[Voice message]';
    } else if (msg.audio) {
      const caption = msg.caption ? ` ${msg.caption}` : '';
      text = `[Audio]${caption}`;
    } else if (msg.video) {
      const caption = msg.caption ? ` ${msg.caption}` : '';
      text = `[Video]${caption}`;
    } else if (msg.sticker) {
      text = `[Sticker ${msg.sticker.emoji ?? ''}]`;
    } else if (msg.location) {
      text = '[Location]';
    } else if (msg.contact) {
      text = '[Contact]';
    } else {
      return; // Unsupported message type — skip silently
    }

    await config.onInbound(chatId, null, {
      id: msgId,
      kind: 'chat',
      timestamp,
      content: {
        text,
        sender,
        sender_name: senderName,
        is_group: isGroup,
        ...(threadId ? { thread_id: threadId } : {}),
        ...replyQuoteContext,
      },
      isMention,
      isGroup,
    });

    log.info('Telegram message received', { chatId, sender: senderName });
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async sendText(chatId: string, text: string): Promise<void> {
    try {
      await this.callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
    } catch (err) {
      // Fallback to plain text when Markdown parse mode fails
      log.debug('Telegram Markdown send failed, retrying plain text', { err });
      await this.callApi('sendMessage', { chat_id: chatId, text });
    }
  }

  private async replyCommand(chatId: number, text: string): Promise<void> {
    try {
      await this.callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
    } catch (err) {
      log.debug('Telegram command reply failed', { chatId, err });
    }
  }

  private async callApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await resp.json()) as TelegramApiResponse<T>;
    if (!json.ok || json.result === undefined) {
      throw new TelegramApiError(
        json.error_code ?? resp.status,
        json.description ?? 'Unknown Telegram API error',
        json.parameters?.retry_after,
      );
    }
    return json.result;
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content || null;
  if (content !== null && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text || null;
  }
  return null;
}

const factory = (): ChannelAdapter | null => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return new TelegramAdapter(token);
};

registerChannelAdapter('telegram', { factory });
