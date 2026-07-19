import { Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';
import type { Logger } from '../config/logger';
import { cardKeyboard } from '../telegram/keyboards';
import { cardCaption, countdownText, numberCalledText } from '../telegram/render';
import type { Card } from '../types/index';
import type { Game } from '@prisma/client';

// Every outbound Telegram interaction funnels through here. All sends are "safe":
// a failed send (user blocked the bot, message deleted, etc.) is logged, never thrown,
// so one player's DM problem can't crash a running game.
export class NotificationService {
  constructor(
    private readonly bot: Telegraf,
    private readonly logger: Logger,
  ) {}

  private html(extra?: object) {
    return { parse_mode: 'HTML' as const, disable_web_page_preview: true, ...extra };
  }

  async sendToChat(
    chatId: bigint | number,
    text: string,
    extra?: object,
  ): Promise<Message.TextMessage | null> {
    try {
      return await this.bot.telegram.sendMessage(Number(chatId), text, this.html(extra));
    } catch (err) {
      this.logger.warn({ err, chatId: String(chatId) }, 'sendToChat failed');
      return null;
    }
  }

  async editText(
    chatId: bigint | number,
    messageId: number,
    text: string,
    extra?: object,
  ): Promise<void> {
    try {
      await this.bot.telegram.editMessageText(
        Number(chatId),
        messageId,
        undefined,
        text,
        this.html(extra),
      );
    } catch (err) {
      // "message is not modified" and similar are expected/benign.
      this.logger.debug({ err, chatId: String(chatId), messageId }, 'editText failed');
    }
  }

  // ---- Game lifecycle broadcasts ----

  async sendCountdown(chatId: bigint, secondsLeft: number): Promise<number | null> {
    const msg = await this.sendToChat(chatId, countdownText(secondsLeft));
    return msg?.message_id ?? null;
  }

  async updateCountdown(chatId: bigint, messageId: number, secondsLeft: number): Promise<void> {
    await this.editText(chatId, messageId, countdownText(secondsLeft));
  }

  async announceNumber(chatId: bigint, number: number, order: number, total: number): Promise<void> {
    await this.sendToChat(chatId, numberCalledText(number, order, total));
  }

  // ---- Player card (DM) ----

  async sendCard(
    dmChatId: bigint,
    game: Game,
    card: Card,
    marked: Set<number>,
    called: Set<number> = new Set(),
  ): Promise<number | null> {
    try {
      const msg = await this.bot.telegram.sendMessage(
        Number(dmChatId),
        cardCaption(game, marked.size),
        this.html(cardKeyboard(game.id, card, marked, called)),
      );
      return msg.message_id;
    } catch (err) {
      this.logger.warn({ err, dmChatId: String(dmChatId) }, 'sendCard failed (user may not have DM-started the bot)');
      return null;
    }
  }

  async refreshCard(
    dmChatId: bigint,
    messageId: number,
    game: Game,
    card: Card,
    marked: Set<number>,
    called: Set<number> = new Set(),
  ): Promise<void> {
    try {
      await this.bot.telegram.editMessageText(
        Number(dmChatId),
        messageId,
        undefined,
        cardCaption(game, marked.size),
        this.html(cardKeyboard(game.id, card, marked, called)),
      );
    } catch (err) {
      this.logger.debug({ err, dmChatId: String(dmChatId) }, 'refreshCard failed');
    }
  }

  // Best-effort pin/unpin for the live board (needs pin permission in groups; always
  // works in private chats). Failures are non-fatal.
  async pin(chatId: bigint, messageId: number): Promise<void> {
    try {
      await this.bot.telegram.pinChatMessage(Number(chatId), messageId, {
        disable_notification: true,
      });
    } catch (err) {
      this.logger.debug({ err, chatId: String(chatId) }, 'pin failed');
    }
  }

  async unpin(chatId: bigint, messageId: number): Promise<void> {
    try {
      await this.bot.telegram.unpinChatMessage(Number(chatId), messageId);
    } catch (err) {
      this.logger.debug({ err, chatId: String(chatId) }, 'unpin failed');
    }
  }
}
