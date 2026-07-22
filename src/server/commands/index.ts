import { Markup, type Context, type Telegraf } from 'telegraf';
import { config } from '../config/env';
import { LIMITS } from '../services/SettingsService';
import type { SettingsService } from '../services/SettingsService';
import type { WalletService } from '../services/WalletService';
import { clearWizard, getWizard, setWizard, startWizard } from '../telegram/wizard';
import type { RoomService } from '../services/RoomService';
import type { StatisticsService } from '../services/StatisticsService';
import { BTN, mainMenuKeyboard, phoneKeyboard, registerKeyboard } from '../telegram/menus';
import { displayName, esc } from '../utils/format';
import { DEFAULT_INSTRUCTIONS, type SupportItem } from '../content/defaults';

// The bot is the entry point; the game itself lives in the Mini App (one continuous room).

const CANCEL = '❌ Cancel';

/** Strip separators and convert +2519…/2519… to the local 09… form. */
function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+251')) p = '0' + p.slice(4);
  else if (p.startsWith('251') && p.length === 12) p = '0' + p.slice(3);
  return p;
}

const PHONE_RE = /^09\d{8}$/;
const PHONE_HINT =
  'The number must start with <b>09</b> and be exactly <b>10 digits</b>.\n' +
  'Example: <code>0912345678</code>';

export function registerHandlers(
  bot: Telegraf,
  room: RoomService,
  stats: StatisticsService,
  wallet: WalletService,
  settings: SettingsService,
  notifyAdmins: (txId: string) => Promise<void>,
  _getBotUsername: () => string | undefined,
): void {
  const ensure = async (ctx: Context) => {
    if (!ctx.from) return null;
    return room.ensureUser({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username ?? undefined,
      firstName: ctx.from.first_name ?? undefined,
    });
  };

  bot.start(async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;

    if (!user.registered) {
      const kb = registerKeyboard();
      await ctx.reply(
        `👋 <b>Welcome to Bingo 75!</b>\n\nTap <b>${BTN.register}</b> below to create your account — one tap, using your Telegram profile.`,
        { parse_mode: 'HTML', ...(kb ?? {}) },
      );
      return;
    }

    const kb = mainMenuKeyboard(user.id, user.telegramId);
    await ctx.reply(
      `👋 <b>Welcome back, ${esc(user.firstName ?? 'player')}!</b>\n\nTap <b>${BTN.play}</b> to join the live room.`,
      { parse_mode: 'HTML', ...(kb ?? {}) },
    );
  });

  /** Finish registration once we have a phone number. */
  const completeRegistration = async (ctx: Context, phone: string) => {
    const user = await ensure(ctx);
    if (!user) return;
    clearWizard(ctx.from!.id);
    const updated = await room.register(user, phone);
    const menu = mainMenuKeyboard(updated.id, updated.telegramId);
    await ctx.reply(
      `✅ <b>Registration complete!</b>\n\n` +
        `Name: <b>${esc(updated.firstName ?? 'player')}</b>\n` +
        `Phone: <code>${esc(phone)}</code>\n` +
        `Balance: <b>${updated.coins}</b> birr\n\n` +
        `Tap <b>${BTN.play}</b> to join the live Bingo room.`,
      { parse_mode: 'HTML', ...(menu ?? {}) },
    );
  };

  // Registration happens entirely in the bot and collects a phone number.
  bot.hears(BTN.register, async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;

    if (user.registered) {
      await ctx.reply('✅ You are already registered.', {
        ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}),
      });
      return;
    }

    startWizard(ctx.from.id, 'register');
    setWizard(ctx.from.id, { step: 'phone' });
    await ctx.reply(
      `📝 <b>Registration</b>\n\nWe just need your <b>phone number</b>.\n\n` +
        `Tap the button below to share it automatically, or type it.\n${PHONE_HINT}`,
      { parse_mode: 'HTML', ...phoneKeyboard() },
    );
  });

  // One-tap phone share
  bot.on('contact', async (ctx) => {
    const wiz = getWizard(ctx.from.id);
    if (!wiz || wiz.flow !== 'register') return;
    await completeRegistration(ctx, normalizePhone(ctx.message.contact.phone_number));
  });

  /** Instructions text: whatever the admin saved, or the built-in default. */
  const instructionsText = async () => {
    const s = await settings.get();
    return s.instructionsText?.trim() ? s.instructionsText : DEFAULT_INSTRUCTIONS;
  };

  /** Support contacts, rendered as a numbered list. */
  const supportText = async () => {
    const items = await settings.support();
    return [
      '📞 <b>support</b>',
      '',
      ...items.map((it, i) => `${i + 1}. ${esc(it.label)}: ${esc(it.handle)}`),
    ].join('\n');
  };

  bot.help(async (ctx) => ctx.reply(await instructionsText(), { parse_mode: 'HTML' }));

  bot.command('menu', async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;
    const kb = user.registered ? mainMenuKeyboard(user.id, user.telegramId) : registerKeyboard();
    await ctx.reply(user.registered ? 'Main menu:' : `Tap ${BTN.register} to get started:`, {
      ...(kb ?? {}),
    });
  });

  // Both of these render admin-editable content, so changing them never needs a deploy.
  bot.hears(BTN.instructions, async (ctx) =>
    ctx.reply(await instructionsText(), { parse_mode: 'HTML' }),
  );

  bot.hears(BTN.support, async (ctx) => {
    const user = await ensure(ctx);
    if (!user?.registered) {
      const kb = registerKeyboard();
      await ctx.reply(`Please tap ${BTN.register} first.`, { ...(kb ?? {}) });
      return;
    }
    await ctx.reply(await supportText(), {
      parse_mode: 'HTML',
      ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}),
    });
  });


  // ---- Balance -------------------------------------------------------------
  bot.hears(BTN.balance, async (ctx) => {
    const user = await ensure(ctx);
    if (!user?.registered) return;
    await ctx.reply(
      `💳 <b>Your balance</b>\n\n<b>${user.coins}</b> birr`,
      { parse_mode: 'HTML' },
    );
  });

  // ---- Deposit / Withdraw wizards ------------------------------------------
  const cancelKb = Markup.keyboard([[CANCEL]]).resize();

  bot.hears(BTN.deposit, async (ctx) => {
    const user = await ensure(ctx);
    if (!user?.registered) return;
    const s = await settings.get();
    startWizard(ctx.from.id, 'deposit');
    setWizard(ctx.from.id, { step: 'amount' });
    await ctx.reply(
      `💰 <b>Deposit</b>\n\n` +
        `💵 How much do you want to deposit?\n` +
        `Minimum: <b>${s.minDeposit}</b> birr\n\n` +
        `Send the amount as a number, e.g. <code>${s.minDeposit}</code>`,
      { parse_mode: 'HTML', ...cancelKb },
    );
  });

  /** Amharic payment instructions for the chosen service, with the player's amount. */
  const depositInstructions = (
    method: 'TELEBIRR' | 'CBE',
    phone: string,
    amount: number,
  ): string => {
    const name = method === 'TELEBIRR' ? 'Tele-Birr' : 'CBE Birr';
    const icon = method === 'TELEBIRR' ? '📱' : '🏦';
    const birr = `${amount}.00`;
    return (
      `${icon} <b>${name}</b>\n\n` +
      `<code>${esc(phone)}</code>\n\n` +
      `የ${name} መመሪያ፦\n\n` +
      `1. ከላይ ባለው የ ${name} ${method === 'TELEBIRR' ? 'አካውንት' : 'ቁጥር'} <b>${birr} ብር</b> ያስገቡ\n` +
      `2. የከፈላችሁበትን የግብይት መረጃ የያዘ አጭር መልእክት (SMS) ከ ${name} ይደርስዎታል\n` +
      `3. ያገኙትን SMS በሙሉ ኮፒ በማድረግ እዚህ በታች ያለው ቴሌግራም መልእክት ቦታ ውስጥ ፔስት በማድረግ ይላኩት`
    );
  };

  // Withdrawal payout service -> ask for the receiving phone number.
  bot.action(/^wd:(tb|cbe)$/, async (ctx) => {
    const wiz = getWizard(ctx.from.id);
    if (!wiz || wiz.flow !== 'withdraw' || wiz.step !== 'method' || !wiz.amount) {
      return void ctx.answerCbQuery('Start again with 💸 Withdraw.', { show_alert: true });
    }
    const method = (ctx.match as unknown as RegExpExecArray)[1] === 'tb' ? 'TELEBIRR' : 'CBE';
    setWizard(ctx.from.id, { step: 'phone', payMethod: method });
    await ctx.answerCbQuery();
    await ctx.reply(
      `📱 Send the <b>${method === 'CBE' ? 'CBE Birr' : 'Telebirr'} phone number</b> that should receive the money.\n\n${PHONE_HINT}`,
      { parse_mode: 'HTML', ...cancelKb },
    );
  });

  // Payment-method choice -> show that service's number + instructions, then wait for
  // the pasted SMS. Photos are no longer part of the deposit flow at all.
  bot.action(/^dep:(tb|cbe)$/, async (ctx) => {
    const wiz = getWizard(ctx.from.id);
    if (!wiz || wiz.flow !== 'deposit' || wiz.step !== 'method' || !wiz.amount) {
      return void ctx.answerCbQuery('Start again with 💰 Deposit.', { show_alert: true });
    }
    const s = await settings.get();
    const method = (ctx.match as unknown as RegExpExecArray)[1] === 'tb' ? 'TELEBIRR' : 'CBE';
    const phone = method === 'TELEBIRR' ? s.depositPhone : s.cbeBirrPhone;
    if (!phone) {
      return void ctx.answerCbQuery('That payment option is not available right now.', { show_alert: true });
    }
    setWizard(ctx.from.id, { step: 'sms', payMethod: method });
    await ctx.answerCbQuery();
    await ctx.reply(depositInstructions(method, phone, wiz.amount), {
      parse_mode: 'HTML',
      ...cancelKb,
    });
  });

  bot.hears(BTN.withdraw, async (ctx) => {
    const user = await ensure(ctx);
    if (!user?.registered) return;
    const s = await settings.get();
    if (user.coins < s.minWithdrawal) {
      await ctx.reply(
        `💸 <b>Withdraw</b>\n\nYou need at least <b>${s.minWithdrawal}</b> birr. You have <b>${user.coins}</b>.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    startWizard(ctx.from.id, 'withdraw');
    setWizard(ctx.from.id, { step: 'amount' });
    await ctx.reply(
      `💸 <b>Withdraw</b>\n\n` +
        `Your balance: <b>${user.coins}</b> birr\n` +
        `Minimum withdrawal: <b>${s.minWithdrawal}</b> birr\n\n` +
        `💵 How much do you want to withdraw?`,
      { parse_mode: 'HTML', ...cancelKb },
    );
  });

  bot.hears(CANCEL, async (ctx) => {
    const user = await ensure(ctx);
    clearWizard(ctx.from.id);
    await ctx.reply('Cancelled.', {
      ...(user ? (mainMenuKeyboard(user.id, user.telegramId) ?? {}) : {}),
    });
  });

  // Deposits are verified by the pasted payment SMS, not photos. If someone sends a
  // screenshot mid-deposit anyway, explain what we actually need.
  bot.on('photo', async (ctx) => {
    const wiz = getWizard(ctx.from.id);
    if (!wiz || wiz.flow !== 'deposit') return;
    await ctx.reply(
      '🚫 Photos and screenshots are not accepted.\n\n' +
        'Please COPY the payment SMS you received and PASTE it here as text.',
      { ...cancelKb },
    );
  });

  bot.on('text', async (ctx, next) => {
    const wiz = getWizard(ctx.from.id);
    if (!wiz) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    const user = await ensure(ctx);
    if (!user) return;
    const s = await settings.get();

    if (wiz.flow === 'config' && wiz.step === 'value' && wiz.configKey) {
      const key = wiz.configKey;
      clearWizard(ctx.from.id);

      const menuKb = mainMenuKeyboard(user.id, user.telegramId) ?? {};

      if (key === 'instructions') {
        // "reset" clears the override so the built-in text comes back.
        const next = text.toLowerCase() === 'reset' ? '' : ctx.message.text;
        await settings.update({ instructionsText: next });
        await ctx.reply(
          next ? '✅ Instructions updated. Players see this now:' : '✅ Restored the built-in instructions:',
          { parse_mode: 'HTML', ...menuKb },
        );
        // Show the result so a broken tag is obvious immediately, not to a player later.
        await ctx
          .reply(await instructionsText(), { parse_mode: 'HTML' })
          .catch(() =>
            ctx.reply(
              '⚠️ Saved, but Telegram could not render it. Check your <b>&lt;b&gt;</b> tags are closed.',
              { parse_mode: 'HTML' },
            ),
          );
        await showAdminPanel(ctx);
        return;
      }

      if (key === 'supAdd' || key.startsWith('supEdit:')) {
        const m = text.match(/^(\S+)\s+(\S+)$/);
        if (!m) {
          return void ctx.reply('Send it as <code>label @handle</code>.', {
            parse_mode: 'HTML',
            ...menuKb,
          });
        }
        const [, label, handle] = m;
        const items = await settings.support();
        if (key === 'supAdd') items.push({ label, handle });
        else {
          const i = Number(key.split(':')[1]);
          if (items[i]) items[i] = { label, handle };
        }
        await saveSupport(items);
        await ctx.reply(`✅ Saved <b>${esc(label)}: ${esc(handle)}</b>`, {
          parse_mode: 'HTML',
          ...menuKb,
        });
        await showSupportPanel(ctx);
        return;
      }

      if (key === 'bonusAll' || key === 'bonusUser') {
        const menu = mainMenuKeyboard(user.id, user.telegramId) ?? {};

        if (key === 'bonusUser') {
          const m = text.match(/^(\S+)\s+(\d+)$/);
          if (!m) {
            return void ctx.reply('Send it as <code>@username 50</code> or <code>123456789 50</code>.', {
              parse_mode: 'HTML',
              ...menu,
            });
          }
          const [, who, amountRaw] = m;
          const amount = Math.floor(Number(amountRaw));
          const target = await wallet.findPlayer(who);
          if (!target) {
            return void ctx.reply(`❌ No player found for <b>${esc(who)}</b>.`, {
              parse_mode: 'HTML',
              ...menu,
            });
          }
          const balance = await wallet.giveBonus(target.id, amount);
          if (balance == null) {
            return void ctx.reply('❌ Amount must be at least 1.', { ...menu });
          }
          await ctx.reply(
            `🎁 Gave <b>${amount}</b> birr to ${esc(displayName(target))}.\nTheir balance: <b>${balance}</b>`,
            { parse_mode: 'HTML', ...menu },
          );
          await ctx.telegram
            .sendMessage(
              target.telegramId.toString(),
              `🎁 <b>You received a bonus!</b>\n\n<b>+${amount}</b> birr has been added to your balance.\n💳 New balance: <b>${balance}</b>`,
              { parse_mode: 'HTML' },
            )
            .catch(() => {}); // the player may have blocked the bot — the coins are still theirs
          await showAdminPanel(ctx);
          return;
        }

        const amount = Math.floor(Number(text));
        if (!Number.isFinite(amount) || amount < 1) {
          return void ctx.reply('Please send a number of at least 1.', { ...menu });
        }
        const { credited, failed } = await wallet.giveBonusToAll(amount);
        await ctx.reply(
          `🎁 Gave <b>${amount}</b> birr to <b>${credited.length}</b> player(s).` +
            (failed > 0 ? `\n⚠️ ${failed} failed — check the logs.` : ''),
          { parse_mode: 'HTML', ...menu },
        );
        // Announce in the background so a big player list never stalls the admin's chat.
        void (async () => {
          for (const c of credited) {
            await ctx.telegram
              .sendMessage(
                c.telegramId.toString(),
                `🎁 <b>Bonus for everyone!</b>\n\n<b>+${amount}</b> birr has been added to your balance.\n💳 New balance: <b>${c.balance}</b>`,
                { parse_mode: 'HTML' },
              )
              .catch(() => {});
            await new Promise((r) => setTimeout(r, 40)); // stay under Telegram's broadcast rate limit
          }
        })();
        await showAdminPanel(ctx);
        return;
      }

      let requested: number | null = null;
      if (key === 'depositPhone') {
        await settings.update({ depositPhone: text });
      } else if (key === 'cbeBirrPhone') {
        await settings.update({ cbeBirrPhone: text });
      } else {
        const n = Math.floor(Number(text));
        if (!Number.isFinite(n)) {
          return void ctx.reply('Please send a number.', { ...cancelKb });
        }
        requested = n;
        await settings.update({ [key]: n } as never);
      }

      const saved = await settings.get();
      const shown = (saved as unknown as Record<string, unknown>)[key];
      // If the value was clamped to the allowed range, say so — never let an admin
      // wonder why the number they typed is not the number on screen.
      const lim = (LIMITS as Record<string, [number, number]>)[key];
      const clamped = requested !== null && Number(shown) !== requested;
      await ctx.reply(
        clamped
          ? `⚠️ <b>${requested}</b> is outside the allowed <b>${lim[0]}–${lim[1]}</b>.\nSaved as <b>${String(shown)}</b>.`
          : `✅ Saved — <b>${String(shown)}</b>`,
        {
          parse_mode: 'HTML',
          ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}),
        },
      );
      await showAdminPanel(ctx);
      return;
    }

    // Registration: the player typed their phone instead of sharing the contact.
    if (wiz.flow === 'register' && wiz.step === 'phone') {
      const phone = normalizePhone(text);
      if (!PHONE_RE.test(phone)) {
        return void ctx.reply(`❌ That is not a valid phone number.\n\n${PHONE_HINT}`, {
          parse_mode: 'HTML',
          ...phoneKeyboard(),
        });
      }
      await completeRegistration(ctx, phone);
      return;
    }

    // Admin typing the reason for a withdrawal rejection.
    if (wiz.flow === 'reject' && wiz.configKey) {
      const txId = wiz.configKey;
      clearWizard(ctx.from.id);
      const res = await wallet.reject(txId, String(ctx.from.id), text);
      if (!res.ok) {
        return void ctx.reply(`❌ ${res.reason}`, { ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}) });
      }
      const tx = res.tx;
      await ctx.reply(`❌ Rejected — the player has been told why.`, {
        ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}),
      });
      const target = await room.userById(tx.userId);
      if (target) {
        await ctx.telegram
          .sendMessage(
            target.telegramId.toString(),
            `❌ <b>Withdrawal rejected</b>\n\n` +
              `Reason: <b>${esc(text)}</b>\n\n` +
              `Your <b>${tx.amount}</b> birr has been returned to your balance.\n` +
              `Balance: <b>${res.balance}</b> birr`,
            { parse_mode: 'HTML' },
          )
          .catch(() => {});
      }
      return;
    }

    if (wiz.flow === 'deposit' && wiz.step === 'sms') {
      // A real payment SMS is a sentence with a reference — not a couple of words.
      if (text.length < 20) {
        return void ctx.reply(
          'That does not look like a payment SMS. Please copy the WHOLE message you received and paste it here.',
          { ...cancelKb },
        );
      }
      const tx = await wallet.createDeposit({
        userId: user.id,
        amount: wiz.amount ?? 0,
        fullName: displayName(user),
        phone: user.phone ?? '-',
        smsText: text,
        payMethod: wiz.payMethod,
      });
      clearWizard(ctx.from.id);
      await ctx.reply(
        `✅ <b>Deposit submitted</b>\n\n` +
          `Amount: <b>${tx.amount}</b> birr\n` +
          `Via: <b>${wiz.payMethod === 'CBE' ? 'CBE Birr' : 'Telebirr'}</b>\n` +
          `Reference: <code>${tx.id.slice(-8)}</code>\n\n` +
          `An admin is verifying your payment. You'll get a message the moment it's approved.`,
        { parse_mode: 'HTML', ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}) },
      );
      await notifyAdmins(tx.id);
      return;
    }

    if (wiz.flow === 'withdraw' && wiz.step === 'name') {
      if (text.length < 3) return void ctx.reply('Please send the full name of the account owner.');

      const res = await wallet.createWithdrawal({
        userId: user.id,
        amount: wiz.amount ?? 0,
        fullName: text,
        phone: wiz.phone ?? '',
        payMethod: wiz.payMethod,
      });
      clearWizard(ctx.from.id);
      if (!res.ok) {
        await ctx.reply(`❌ ${res.reason}`, { ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}) });
        return;
      }
      const service = wiz.payMethod === 'CBE' ? 'CBE Birr' : 'Telebirr';
      await ctx.reply(
        `✅ <b>Withdrawal requested</b>\n\n` +
          `Amount: <b>${wiz.amount}</b> birr\n` +
          `To: <code>${esc(wiz.phone ?? '')}</code> (${service})\n` +
          `Account name: <b>${esc(text)}</b>\n` +
          `Reference: <code>${res.tx.id.slice(-8)}</code>\n\n` +
          `Your birr is on hold. It will be reviewed and sent within <b>${s.withdrawHours} hour${s.withdrawHours === 1 ? '' : 's'}</b>.`,
        { parse_mode: 'HTML', ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}) },
      );
      await notifyAdmins(res.tx.id);
      return;
    }

    if (wiz.flow === 'withdraw' && wiz.step === 'phone') {
      const phone = normalizePhone(text);
      if (!PHONE_RE.test(phone)) {
        return void ctx.reply(`❌ That is not a valid phone number.\n\n${PHONE_HINT}`, {
          parse_mode: 'HTML',
          ...cancelKb,
        });
      }
      setWizard(ctx.from.id, { phone, step: 'name' });
      await ctx.reply(
        `👤 Now send the <b>full name of the account owner</b> for <code>${esc(phone)}</code>,\n` +
          `so we can make sure the money goes to the right person.`,
        { parse_mode: 'HTML', ...cancelKb },
      );
      return;
    }

    if (wiz.step === 'amount') {
      const amount = Math.floor(Number(text));
      const min = wiz.flow === 'deposit' ? s.minDeposit : s.minWithdrawal;
      if (!Number.isFinite(amount) || amount < min) {
        return void ctx.reply(`Please send a number of at least ${min}.`);
      }

      if (wiz.flow === 'deposit') {
        setWizard(ctx.from.id, { amount, step: 'method' });
        const buttons = [Markup.button.callback('📱 Telebirr', 'dep:tb')];
        if (s.cbeBirrPhone) buttons.push(Markup.button.callback('🏦 CBE Birr', 'dep:cbe'));
        await ctx.reply(
          `💳 <b>${amount} birr</b> — how will you pay?`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([buttons]) },
        );
        return;
      }

      // withdrawal: pick the payout service next
      if (amount > user.coins) {
        return void ctx.reply(`You only have ${user.coins} birr.`);
      }
      setWizard(ctx.from.id, { amount, step: 'method' });
      await ctx.reply(`💳 <b>${amount} birr</b> — where should we send it?`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📱 Telebirr', 'wd:tb'),
            Markup.button.callback('🏦 CBE Birr', 'wd:cbe'),
          ],
        ]),
      });
      return;
    }

    return next();
  });


  // ---- Admin configuration panel -------------------------------------------
  const isAdmin = (ctx: Context) =>
    config.ADMIN_TELEGRAM_IDS.includes(String(ctx.from?.id ?? ''));

  /** Numeric settings the admin can edit from the bot. */
  // Same names and descriptions as the web dashboard, so both admin surfaces speak
  // one language.
  const CFG: { key: string; label: string; desc: string; unit?: string }[] = [
    { key: 'entryFee', label: 'Stake per card', desc: 'Birr charged for each card a player takes' },
    { key: 'houseCutPercent', label: 'House cut', desc: 'Percent the house keeps; the winner gets the rest', unit: '%' },
    { key: 'startingCoins', label: 'Welcome bonus', desc: 'Birr given once when a player registers' },
    { key: 'maxCardsPerPlayer', label: 'Cards per player', desc: 'Most cards one player may hold in a round' },
    { key: 'selectionSeconds', label: 'Card selection time', desc: 'Seconds players get to pick cards', unit: 's' },
    { key: 'drawIntervalSeconds', label: 'Number call speed', desc: 'Seconds between called numbers', unit: 's' },
    { key: 'winnerDisplaySeconds', label: 'Winner screen time', desc: 'Seconds the winner is shown', unit: 's' },
    { key: 'minPlayers', label: 'Minimum players', desc: 'Players required for a round to start' },
    { key: 'minDeposit', label: 'Minimum deposit', desc: 'Smallest deposit a player may request' },
    { key: 'minWithdrawal', label: 'Minimum withdrawal', desc: 'Smallest withdrawal a player may request' },
    { key: 'withdrawHours', label: 'Withdrawal time', desc: 'Hours promised to review and send a withdrawal', unit: 'h' },
    { key: 'falseBingoCooldownSec', label: 'Wrong-bingo cooldown', desc: 'Seconds blocked after a false BINGO; 0 = off', unit: 's' },
  ];

  const PATTERN_KEYS = ['HORIZONTAL', 'VERTICAL', 'DIAGONAL', 'FOUR_CORNERS', 'FULL_HOUSE'];

  const adminPanel = async () => {
    const s = await settings.get();
    const rec = s as unknown as Record<string, number | string | string[]>;
    const pending = await wallet.count('PENDING');

    const text = [
      '⚙️ <b>Admin — Game settings</b>',
      '',
      ...CFG.map((f) => `${f.label}: <b>${rec[f.key]}${f.unit ?? ''}</b>`),
      `Telebirr number: <code>${s.depositPhone}</code>`,
      `CBE Birr number: <code>${s.cbeBirrPhone || 'not set'}</code>`,
      `Winning patterns: <b>${s.patterns.join(', ')}</b>`,
      '',
      pending > 0 ? `📋 <b>${pending}</b> request(s) awaiting review` : '📋 No pending requests',
      '',
      '<i>Tap a setting to change it.</i>',
    ].join('\n');

    const rows = [];
    for (let i = 0; i < CFG.length; i += 2) {
      rows.push(
        CFG.slice(i, i + 2).map((f) =>
          Markup.button.callback(`${f.label}: ${rec[f.key]}${f.unit ?? ''}`, `cfg:${f.key}`),
        ),
      );
    }
    rows.push([
      Markup.button.callback('📱 Telebirr number', 'cfg:depositPhone'),
      Markup.button.callback('🏦 CBE Birr number', 'cfg:cbeBirrPhone'),
    ]);
    rows.push(
      PATTERN_KEYS.map((p) =>
        Markup.button.callback(`${s.patterns.includes(p) ? '✅' : '▫️'} ${p[0]}${p.slice(1, 4).toLowerCase()}`, `cfgp:${p}`),
      ),
    );
    rows.push([
      Markup.button.callback('📋 Pending requests', 'cfg:pending'),
      Markup.button.callback('🔄 Refresh', 'cfg:refresh'),
    ]);
    rows.push([
      Markup.button.callback('🎁 Bonus — everyone', 'cfg:bonusAll'),
      Markup.button.callback('🎁 Bonus — one player', 'cfg:bonusUser'),
    ]);
    rows.push([
      Markup.button.callback('📞 Support contacts', 'cfg:support'),
      Markup.button.callback('📖 Instructions', 'cfg:instructions'),
    ]);
    rows.push([Markup.button.callback('🛑 Close game & start new', 'cfg:reset')]);
    return { text, kb: Markup.inlineKeyboard(rows) };
  };

  const showAdminPanel = async (ctx: Context) => {
    const { text, kb } = await adminPanel();
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  };

  /**
   * Support contacts editor: one row per contact with an edit and a remove button,
   * so an admin never has to retype the whole list to change one entry.
   */
  const showSupportPanel = async (ctx: Context) => {
    const items = await settings.support();
    const rows = items.map((it, i) => [
      Markup.button.callback(`✏️ ${it.label}: ${it.handle}`, `sup:edit:${i}`),
      Markup.button.callback('🗑', `sup:del:${i}`),
    ]);
    rows.push([Markup.button.callback('➕ Add contact', 'sup:add')]);
    rows.push([Markup.button.callback('⬅️ Back', 'cfg:refresh')]);

    await ctx.reply(
      [
        '📞 <b>Support contacts</b>',
        '',
        'This is what players see:',
        '',
        ...items.map((it, i) => `${i + 1}. ${esc(it.label)}: ${esc(it.handle)}`),
        '',
        '<i>Tap a contact to edit it, or 🗑 to remove it.</i>',
      ].join('\n'),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) },
    );
  };

  /** Persist a new contact list. */
  const saveSupport = (items: SupportItem[]) => settings.update({ supportItems: items });

  bot.action(/^sup:(add|edit|del):?(\d+)?$/, async (ctx) => {
    if (!isAdmin(ctx)) return void ctx.answerCbQuery('Admins only.', { show_alert: true });
    const m = ctx.match as unknown as RegExpExecArray;
    const action = m[1];
    const index = m[2] != null ? Number(m[2]) : -1;
    const items = await settings.support();

    if (action === 'del') {
      if (items.length <= 1) {
        return void ctx.answerCbQuery('Keep at least one contact.', { show_alert: true });
      }
      const removed = items[index];
      await saveSupport(items.filter((_, i) => i !== index));
      await ctx.answerCbQuery(`Removed ${removed?.label ?? 'contact'}`);
      await showSupportPanel(ctx);
      return;
    }

    // Add and edit share one wizard; the index decides which.
    startWizard(ctx.from.id, 'config');
    setWizard(ctx.from.id, { step: 'value', configKey: action === 'add' ? 'supAdd' : `supEdit:${index}` });
    await ctx.answerCbQuery();
    const current = action === 'edit' ? items[index] : undefined;
    await ctx.reply(
      (current
        ? `✏️ Editing <b>${esc(current.label)}: ${esc(current.handle)}</b>\n\n`
        : '➕ <b>New support contact</b>\n\n') +
        'Send it as <b>label</b> then <b>handle</b>, separated by a space.\n\n' +
        '<i>Examples:</i>\n<code>support @ciroobingosupport</code>\n<code>chanel @ciroobingo9</code>',
      { parse_mode: 'HTML', ...Markup.keyboard([[CANCEL]]).resize() },
    );
  });

  bot.hears(BTN.admin, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await showAdminPanel(ctx);
  });
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await showAdminPanel(ctx);
  });

  // Toggle a winning pattern on/off
  bot.action(/^cfgp:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return void ctx.answerCbQuery('Admins only.', { show_alert: true });
    const key = (ctx.match as unknown as RegExpExecArray)[1];
    const s = await settings.get();
    const next = s.patterns.includes(key)
      ? s.patterns.filter((p) => p !== key)
      : [...s.patterns, key];
    if (next.length === 0) return void ctx.answerCbQuery('At least one pattern must stay on.', { show_alert: true });
    await settings.update({ patterns: next });
    await ctx.answerCbQuery(`${key}: ${next.includes(key) ? 'on' : 'off'}`);
    const { text, kb } = await adminPanel();
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(() => {});
  });

  // Edit a value / refresh / list pending
  bot.action(/^cfg:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return void ctx.answerCbQuery('Admins only.', { show_alert: true });
    const key = (ctx.match as unknown as RegExpExecArray)[1];

    if (key === 'refresh') {
      await ctx.answerCbQuery('Refreshed');
      const { text, kb } = await adminPanel();
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(() => {});
      return;
    }

    if (key === 'reset') {
      const res = await room.resetRoom('admin closed the game');
      await ctx.answerCbQuery(
        res.refunded > 0 ? `🛑 Closed — ${res.refunded} stake(s) refunded` : '🛑 Closed',
        { show_alert: true },
      );
      const { text, kb } = await adminPanel();
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(() => {});
      return;
    }

    if (key === 'pending') {
      await ctx.answerCbQuery();
      const items = await wallet.list({ status: 'PENDING', take: 10 });
      if (items.length === 0) return void ctx.reply('📋 No pending requests.');
      for (const t of items) {
        const who = t.user.username ? `@${t.user.username}` : (t.user.firstName ?? 'player');
        await ctx.reply(
          `🔐 <b>ADMIN REVIEW</b>\n${t.type === 'DEPOSIT' ? '💰 Deposit' : '💸 Withdrawal'}\n\n` +
            `From: ${who}\nName: <b>${esc(t.fullName)}</b>\nPhone: <code>${esc(t.phone)}</code>\n` +
            `Amount: <b>${t.amount}</b> birr\nRef: <code>${t.id.slice(-8)}</code>` +
            (t.smsText ? `\n\n📩 <b>Pasted SMS:</b>\n<code>${esc(t.smsText.slice(0, 500))}</code>` : ''),
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Approve', `tx:approve:${t.id}`),
                Markup.button.callback('❌ Reject', `tx:reject:${t.id}`),
              ],
            ]),
          },
        );
      }
      return;
    }

    if (key === 'support') {
      await ctx.answerCbQuery();
      await showSupportPanel(ctx);
      return;
    }

    if (key === 'instructions') {
      startWizard(ctx.from.id, 'config');
      setWizard(ctx.from.id, { step: 'value', configKey: 'instructions' });
      await ctx.answerCbQuery();
      await ctx.reply('📖 <b>Instructions</b>\n\nThis is what players see now:', {
        parse_mode: 'HTML',
      });
      await ctx.reply(await instructionsText(), { parse_mode: 'HTML' });
      await ctx.reply(
        'Send the <b>new instructions</b> text to replace it.\n\n' +
          'You may use <code>&lt;b&gt;bold&lt;/b&gt;</code> and <code>&lt;i&gt;italic&lt;/i&gt;</code>.\n' +
          'Send <code>reset</code> to restore the built-in text.',
        { parse_mode: 'HTML', ...Markup.keyboard([[CANCEL]]).resize() },
      );
      return;
    }

    if (key === 'bonusAll' || key === 'bonusUser') {
      startWizard(ctx.from.id, 'config');
      setWizard(ctx.from.id, { step: 'value', configKey: key });
      await ctx.answerCbQuery();
      await ctx.reply(
        key === 'bonusAll'
          ? '🎁 <b>Bonus for everyone</b>\n\nSend the amount of birr to give <b>each registered player</b>.\n\n<i>Example:</i> <code>50</code>'
          : '🎁 <b>Bonus for one player</b>\n\nSend the player and the amount, separated by a space.\n\n' +
              '<i>Examples:</i>\n<code>@username 50</code>\n<code>1233811688 50</code>',
        { parse_mode: 'HTML', ...Markup.keyboard([[CANCEL]]).resize() },
      );
      return;
    }

    const field = CFG.find((f) => f.key === key);
    const isPhone = key === 'depositPhone' || key === 'cbeBirrPhone';
    if (!field && !isPhone) return void ctx.answerCbQuery('Unknown setting.');

    startWizard(ctx.from.id, 'config');
    setWizard(ctx.from.id, { step: 'value', configKey: key });
    await ctx.answerCbQuery();
    const s = await settings.get();
    const current = (s as unknown as Record<string, unknown>)[key];
    const lim = (LIMITS as Record<string, [number, number]>)[key];
    await ctx.reply(
      `✏️ <b>${field?.label ?? 'Telebirr number'}</b>\n` +
        (field?.desc ? `<i>${field.desc}</i>\n\n` : '\n') +
        `Current: <b>${String(current)}${field?.unit ?? ''}</b>\n` +
        (lim ? `Allowed: <b>${lim[0]}–${lim[1]}</b>\n\n` : '\n') +
        `Send the new value:`,
      { parse_mode: 'HTML', ...Markup.keyboard([[CANCEL]]).resize() },
    );
  });

  bot.command('stats', async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;
    const s = await stats.forUser(user.id);
    if (!s) {
      await ctx.reply('No stats yet — play a round first!');
      return;
    }
    await ctx.reply(
      `📈 <b>Your stats</b>\nPlayed: <b>${s.gamesPlayed}</b>\nWon: <b>${s.gamesWon}</b>\n` +
        `BINGOs: <b>${s.bingosCalled}</b>\nFalse BINGOs: <b>${s.falseBingos}</b>`,
      { parse_mode: 'HTML' },
    );
  });

}

export const COMMAND_MENU = [
  { command: 'start', description: 'Start / open the menu' },
  { command: 'menu', description: 'Show the main menu' },
  { command: 'stats', description: 'Your statistics' },
  { command: 'help', description: 'How to play' },
];
