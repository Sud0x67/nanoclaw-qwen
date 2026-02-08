import { Bot, Context } from 'grammy';

import {
  ASSISTANT_NAME,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ENABLED,
  TRIGGER_PATTERN,
} from './config.js';
import { storeChatMetadata } from './db.js';
import { logger } from './logger.js';

let bot: Bot | null = null;

interface TelegramCallbacks {
  onMessage: (chatId: string, text: string, senderName: string) => Promise<string | null>;
}

export function isTelegramEnabled(): boolean {
  return TELEGRAM_ENABLED;
}

export async function startTelegramBot(
  callbacks: TelegramCallbacks,
): Promise<void> {
  if (!TELEGRAM_ENABLED) {
    logger.info('Telegram bot disabled (no TELEGRAM_BOT_TOKEN)');
    return;
  }

  bot = new Bot(TELEGRAM_BOT_TOKEN);

  bot.on('message:text', async (ctx: Context) => {
    const text = ctx.message?.text;
    const chatId = ctx.chat?.id?.toString();
    const senderName = ctx.from?.first_name || ctx.from?.username || 'Unknown';

    if (!text || !chatId) return;

    const telegramJid = `telegram:${chatId}`;

    // Store chat metadata for discovery
    storeChatMetadata(telegramJid, new Date().toISOString());

    logger.info({ chatId, senderName, length: text.length }, 'Telegram message received');

    // For separate mode, require trigger in groups; allow private chats without trigger
    const isPrivateChat = ctx.chat?.type === 'private';
    const shouldTrigger = isPrivateChat || TRIGGER_PATTERN.test(text);
    if (!shouldTrigger) return;

    // Send typing indicator
    await ctx.replyWithChatAction('typing');

    try {
      const response = await callbacks.onMessage(telegramJid, text, senderName);

      if (response) {
        const maxLength = 4096;
        if (response.length <= maxLength) {
          await ctx.reply(response);
        } else {
          const chunks: string[] = [];
          for (let i = 0; i < response.length; i += maxLength) {
            chunks.push(response.slice(i, i + maxLength));
          }
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        }
      }
    } catch (err) {
      logger.error({ err, chatId }, 'Error processing Telegram message');
      await ctx.reply('Sorry, something went wrong processing your message.');
    }
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, 'Telegram bot error');
  });

  await bot.start();
  logger.info({ assistant: ASSISTANT_NAME }, 'Telegram bot started');
}

export async function stopTelegramBot(): Promise<void> {
  if (bot) {
    await bot.stop();
    logger.info('Telegram bot stopped');
  }
}

export async function sendTelegramMessage(
  telegramJid: string,
  text: string,
): Promise<void> {
  if (!bot) {
    logger.error({ telegramJid }, 'Telegram bot not started');
    return;
  }

  const rawId = telegramJid.startsWith('telegram:')
    ? telegramJid.split(':')[1]
    : telegramJid;
  const chatId = Number(rawId);
  if (!Number.isFinite(chatId)) {
    logger.error({ telegramJid }, 'Invalid Telegram chat id');
    return;
  }

  const maxLength = 4096;
  if (text.length <= maxLength) {
    await bot.api.sendMessage(chatId, text);
    return;
  }

  for (let i = 0; i < text.length; i += maxLength) {
    await bot.api.sendMessage(chatId, text.slice(i, i + maxLength));
  }
}
