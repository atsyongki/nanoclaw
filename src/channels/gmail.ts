import fs from 'fs';
import os from 'os';
import path from 'path';

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { GMAIL_FORWARD_TO_AGENT } from '../config.js';
import { log } from '../log.js';
import type { ChannelAdapter, ChannelSetup, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';

interface ThreadMeta {
  sender: string;
  senderName: string;
  subject: string;
  messageId: string; // RFC 2822 Message-ID for In-Reply-To
}

function createAdapter(): ChannelAdapter {
  let oauth2Client: OAuth2Client | null = null;
  let gmail: gmail_v1.Gmail | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let processedIds = new Set<string>();
  const threadMeta = new Map<string, ThreadMeta>();
  let consecutiveErrors = 0;
  let userEmail = '';
  const pollIntervalMs = 60000;

  const adapter: ChannelAdapter = {
    name: 'gmail',
    channelType: 'gmail',
    supportsThreads: false,

    async setup(config: ChannelSetup): Promise<void> {
      const credDir = path.join(os.homedir(), '.gmail-mcp');
      const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
      const tokensPath = path.join(credDir, 'credentials.json');

      const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));

      const clientConfig = keys.installed || keys.web || keys;
      const { client_id, client_secret, redirect_uris } = clientConfig;
      oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
      oauth2Client.setCredentials(tokens);

      // Persist refreshed tokens
      oauth2Client.on('tokens', (newTokens: import('google-auth-library').Credentials) => {
        try {
          const current = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
          Object.assign(current, newTokens);
          fs.writeFileSync(tokensPath, JSON.stringify(current, null, 2));
          log.debug('Gmail OAuth tokens refreshed');
        } catch (err) {
          log.warn('Failed to persist refreshed Gmail tokens', { err });
        }
      });

      gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Verify connection and capture user email
      const profile = await gmail.users.getProfile({ userId: 'me' });
      userEmail = profile.data.emailAddress || '';
      log.info('Gmail channel connected', { email: userEmail });

      config.onMetadata(userEmail, userEmail, false);

      if (!GMAIL_FORWARD_TO_AGENT) {
        log.info('Gmail polling disabled (GMAIL_FORWARD_TO_AGENT=false)');
        return;
      }

      const schedulePoll = () => {
        const backoffMs =
          consecutiveErrors > 0
            ? Math.min(pollIntervalMs * Math.pow(2, consecutiveErrors), 30 * 60 * 1000)
            : pollIntervalMs;
        pollTimer = setTimeout(() => {
          pollForMessages(config)
            .catch((err) => log.error('Gmail poll error', { err }))
            .finally(() => {
              if (gmail) schedulePoll();
            });
        }, backoffMs);
      };

      await pollForMessages(config);
      schedulePoll();
    },

    async teardown(): Promise<void> {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      gmail = null;
      oauth2Client = null;
      log.info('Gmail channel stopped');
    },

    isConnected(): boolean {
      return gmail !== null;
    },

    async deliver(_platformId: string, _threadId: string | null, _message: OutboundMessage): Promise<string | undefined> {
      // Gmail is primarily an inbound channel. Replies via email are not
      // supported in the v2 adapter (threadId is null; no per-thread routing).
      return undefined;
    },
  };

  async function pollForMessages(config: ChannelSetup): Promise<void> {
    if (!gmail) return;

    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread category:primary',
        maxResults: 10,
      });

      const messages = res.data.messages || [];

      for (const stub of messages) {
        if (!stub.id || processedIds.has(stub.id)) continue;
        processedIds.add(stub.id);
        await processMessage(stub.id, config);
      }

      // Cap processed ID set to prevent unbounded growth
      if (processedIds.size > 5000) {
        const ids = [...processedIds];
        processedIds = new Set(ids.slice(ids.length - 2500));
      }

      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const backoffMs = Math.min(
        pollIntervalMs * Math.pow(2, consecutiveErrors),
        30 * 60 * 1000,
      );
      log.error('Gmail poll failed', {
        err,
        consecutiveErrors,
        nextPollMs: backoffMs,
      });
    }
  }

  async function processMessage(messageId: string, config: ChannelSetup): Promise<void> {
    if (!gmail) return;

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = msg.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const subject = getHeader('Subject');
    const rfc2822MessageId = getHeader('Message-ID');
    const gmailThreadId = msg.data.threadId || messageId;
    const timestamp = new Date(parseInt(msg.data.internalDate || '0', 10)).toISOString();

    const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/);
    const senderName = senderMatch ? senderMatch[1].replace(/"/g, '') : from;
    const senderEmail = senderMatch ? senderMatch[2] : from;

    // Skip emails from self (our own replies)
    if (senderEmail === userEmail) return;

    const body = extractTextBody(msg.data.payload);

    if (!body) {
      log.debug('Skipping email with no text body', { messageId, subject });
      return;
    }

    // Cache thread metadata for potential future reply use
    threadMeta.set(gmailThreadId, {
      sender: senderEmail,
      senderName,
      subject,
      messageId: rfc2822MessageId,
    });

    log.info('Gmail email received', { from: senderName, subject, emailId: messageId });

    await config.onInbound(userEmail, null, {
      id: messageId,
      kind: 'chat',
      timestamp,
      content: {
        sender: senderEmail,
        text: body,
        emailId: messageId,
        subject,
      },
    });

    // Mark as read
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch (err) {
      log.warn('Failed to mark email as read', { messageId, err });
    }
  }

  function extractTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
      for (const part of payload.parts) {
        const text = extractTextBody(part);
        if (text) return text;
      }
    }

    return '';
  }

  return adapter;
}

function createAdapterIfCredentialsExist(): ChannelAdapter | null {
  const credDir = path.join(os.homedir(), '.gmail-mcp');
  if (
    !fs.existsSync(path.join(credDir, 'gcp-oauth.keys.json')) ||
    !fs.existsSync(path.join(credDir, 'credentials.json'))
  ) {
    log.warn('Gmail: credentials not found in ~/.gmail-mcp/, skipping channel');
    return null;
  }
  return createAdapter();
}

registerChannelAdapter('gmail', { factory: createAdapterIfCredentialsExist });
