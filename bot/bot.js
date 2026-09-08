import { Telegraf, Markup } from 'telegraf';
import 'dotenv/config';
import {
  RANK_TITLES,
  ensureProfile,
  registerChat,
  getCurrentStatus,
  getLeaderboard,
  getUserRankPosition,
  pickRandomEvent,
  awardProgress,
  recordEventResponse,
  getAchievementsWithProgress,
  checkAndUnlockAchievements,
  getShopItems,
  purchaseItem,
} from './supabase.js';

if (!process.env.BOT_TOKEN) throw new Error('Заполните BOT_TOKEN в .env');

const bot = new Telegraf(process.env.BOT_TOKEN);
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://example.com';

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

function xpForNextLevel(level) {
  return level * 500;
}

function levelProgressText(profile) {
  const next = xpForNextLevel(profile.level);
  return `${profile.xp} / ${next} XP`;
}

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🎮 Играть', 'menu:game'), Markup.button.callback('👤 Профиль', 'menu:profile')],
  [Markup.button.callback('🏆 Топ', 'menu:top'), Markup.button.callback('🛒 Магазин', 'menu:shop')],
  [Markup.button.webApp('🚀 Открыть RADAR', MINI_APP_URL)],
]);

async function replyStatus(ctx) {
  const status = await getCurrentStatus();
  const bullets = (status.summary_bullets ?? []).map((b) => `• ${b}`).join('\n') || '• Нет данных.';
  const stateEmoji = status.state === 'ТРЕВОГА' ? '🔴' : status.state === 'ВНИМАНИЕ' ? '🟡' : '🟢';
  const updated = new Date(status.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const text =
    `📡 *RADAR | Статус системы*\n\n` +
    `${stateEmoji} *СОСТОЯНИЕ: ${status.state}*\n\n` +
    `• Активность БПЛА: ${status.activity_level}\n` +
    `• Последнее обновление: ${updated}\n\n` +
    `*Краткая сводка:*\n${bullets}\n\n` +
    `_${status.source_note}_`;

  await ctx.replyWithMarkdown(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('📊 Подробнее', 'status:more'), Markup.button.callback('🔄 Обновить', 'status:refresh')],
    ])
  );
}

async function replyBrief(ctx) {
  const status = await getCurrentStatus();
  const bullets = (status.summary_bullets ?? []).map((b) => `• ${b}`).join('\n') || '• Нет данных.';
  await ctx.replyWithMarkdown(`🗒 *RADAR | Краткая сводка*\n\n${bullets}\n\n_${status.source_note}_`);
}

async function replyTop(ctx, telegramId) {
  const [board, position] = await Promise.all([getLeaderboard(5), getUserRankPosition(telegramId)]);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = board
    .map((p, i) => {
      const medal = medals[i] ?? `${i + 1}.`;
      const name = p.first_name || p.username || 'Оператор';
      return `${medal} ${name} — ${p.xp} XP • Ур. ${p.level}`;
    })
    .join('\n');

  await ctx.replyWithMarkdown(
    `🏆 *ТОП ОПЕРАТОРОВ*\n\n${lines || 'Пока нет данных.'}\n\n📈 Твой ранг: #${position.position} из ${position.total}`
  );
}

async function replyProfile(ctx, profile) {
  const rankTitle = RANK_TITLES[profile.rank_code] ?? profile.rank_code;
  const name = profile.first_name || profile.username || 'Оператор';
  const text =
    `👤 *Профиль оператора*\n\n` +
    `*${name}*\n${rankTitle} • Ур. ${profile.level}\n${levelProgressText(profile)}\n\n` +
    `🪙 RADAR COINS: ${profile.coins}\n` +
    `📡 Всего событий: ${profile.events_total}\n` +
    `🔥 Серия дней: ${profile.streak_days}`;

  await ctx.replyWithMarkdown(
    text,
    Markup.inlineKeyboard([[Markup.button.callback('🏅 Все достижения', 'menu:achievements')]])
  );
}

async function replyAchievements(ctx, telegramId) {
  const list = await getAchievementsWithProgress(telegramId);
  const lines = list
    .map((a) => {
      const mark = a.unlocked ? '✅' : `${Math.min(a.progress, a.requirement_value)}/${a.requirement_value}`;
      return `${a.icon} *${a.title}* — ${a.description}\n${mark}`;
    })
    .join('\n\n');

  await ctx.replyWithMarkdown(`🎖 *Достижения*\n\n${lines}`);
}

async function replyShop(ctx, coins) {
  const items = await getShopItems();
  const text = `🛒 *Магазин*\n\n🪙 RADAR COINS: ${coins}\n\nВыбери, что купить:`;
  const rows = items.map((i) => [
    Markup.button.callback(`${i.icon} ${i.title} — ${i.price_coins} 🪙`, `buy:${i.code}`),
  ]);
  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(rows));
}

async function replyHelp(ctx) {
  const text =
    `ℹ️ *Что делать при угрозе*\n\n` +
    `1. Сохраняйте спокойствие.\n` +
    `2. Следите за официальными сообщениями.\n` +
    `3. Не распространяйте непроверенную информацию.\n` +
    `4. При обнаружении подозрительных объектов сообщите в экстренные службы.\n\n` +
    `⚠️ Помните: паника опаснее самой угрозы.`;
  await ctx.replyWithMarkdown(text);
}

async function replyCommands(ctx) {
  const text =
    `📋 *RADAR | Список команд*\n\n` +
    `/статус — текущая обстановка\n` +
    `/сводка — краткая сводка\n` +
    `/игра — игровое событие\n` +
    `/топ — рейтинг операторов\n` +
    `/профиль — твой профиль\n` +
    `/магазин — магазин за coins\n` +
    `/достижения — достижения\n` +
    `/помощь — что делать при угрозе`;
  await ctx.replyWithMarkdown(text);
}

// Активные игровые события в памяти: message key -> { eventId, expiresAt, resolved }
const activeEvents = new Map();

async function startGameEvent(ctx) {
  const event = await pickRandomEvent();
  if (!event) {
    await ctx.reply('Сейчас нет доступных событий. Загляни позже.');
    return;
  }

  const sent = await ctx.replyWithMarkdown(
    `🎮 *RADAR | Игровой режим*\n\n` +
      `*Событие #${event.id}*\n${event.description}\n\n` +
      `Что делаем?\n\nУ тебя есть 30 секунд!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Проверить данные', `game:${event.id}:check`)],
      [Markup.button.callback('📡 Запросить подтверждение', `game:${event.id}:confirm`)],
      [Markup.button.callback('🚨 Объявить тревогу', `game:${event.id}:alarm`)],
    ])
  );

  const key = `${sent.chat.id}:${sent.message_id}`;
  const startedAt = Date.now();
  activeEvents.set(key, { eventId: event.id, correctChoice: event.correct_choice, startedAt, resolved: false });

  setTimeout(async () => {
    const state = activeEvents.get(key);
    if (state && !state.resolved) {
      state.resolved = true;
      try {
        await ctx.telegram.editMessageText(
          sent.chat.id,
          sent.message_id,
          undefined,
          `⏱ *Событие #${event.id} — время вышло.*\nРешение не было принято.`,
          { parse_mode: 'Markdown' }
        );
      } catch (_) {
        /* сообщение могло быть уже изменено — игнорируем */
      }
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Middleware: всегда подтягиваем/создаём профиль и регистрируем чат
// ---------------------------------------------------------------------------

bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    ctx.state.profile = await ensureProfile(ctx.from);
  }
  if (ctx.chat) {
    registerChat(ctx.chat).catch(() => {});
  }
  return next();
});

// ---------------------------------------------------------------------------
// Команды (работают и в личке, и в группах)
// ---------------------------------------------------------------------------

bot.start(async (ctx) => {
  const name = ctx.state.profile?.first_name || ctx.from.first_name || 'оператор';
  const text =
    `📡 *RADAR*\n\n` +
    `Добро пожаловать, ${name}!\nЯ — RADAR, твой помощник по безопасности и игровой системе.\n\n` +
    `Здесь ты можешь:\n` +
    `🛡 Узнавать актуальную информацию о БПЛА и других угрозах (только проверенные источники)\n` +
    `🎮 Играть и зарабатывать RADAR COINS\n` +
    `🏆 Участвовать в рейтинге и получать достижения`;
  await ctx.replyWithMarkdown(text, mainMenuKeyboard);
});

bot.command(['статус', 'status'], replyStatus);
bot.command(['сводка', 'brief'], replyBrief);
bot.command(['топ', 'top'], (ctx) => replyTop(ctx, ctx.from.id));
bot.command(['профиль', 'profile'], (ctx) => replyProfile(ctx, ctx.state.profile));
bot.command(['игра', 'game'], startGameEvent);
bot.command(['магазин', 'shop'], (ctx) => replyShop(ctx, ctx.state.profile.coins));
bot.command(['достижения', 'achievements'], (ctx) => replyAchievements(ctx, ctx.from.id));
bot.command(['помощь', 'help'], replyHelp);
bot.command(['команды', 'commands'], replyCommands);

// ---------------------------------------------------------------------------
// Inline-меню (кнопки из /start)
// ---------------------------------------------------------------------------

bot.action('menu:game', async (ctx) => {
  await ctx.answerCbQuery();
  await startGameEvent(ctx);
});
bot.action('menu:profile', async (ctx) => {
  await ctx.answerCbQuery();
  await replyProfile(ctx, ctx.state.profile);
});
bot.action('menu:top', async (ctx) => {
  await ctx.answerCbQuery();
  await replyTop(ctx, ctx.from.id);
});
bot.action('menu:shop', async (ctx) => {
  await ctx.answerCbQuery();
  await replyShop(ctx, ctx.state.profile.coins);
});
bot.action('menu:achievements', async (ctx) => {
  await ctx.answerCbQuery();
  await replyAchievements(ctx, ctx.from.id);
});
bot.action('status:refresh', async (ctx) => {
  await ctx.answerCbQuery('Обновлено');
  await replyStatus(ctx);
});
bot.action('status:more', async (ctx) => {
  await ctx.answerCbQuery();
  await replyBrief(ctx);
});

// ---------------------------------------------------------------------------
// Игровые события: обработка выбора
// ---------------------------------------------------------------------------

bot.action(/^game:(\d+):(check|confirm|alarm)$/, async (ctx) => {
  const eventId = Number(ctx.match[1]);
  const choice = ctx.match[2];
  const key = `${ctx.chat.id}:${ctx.callbackQuery.message.message_id}`;
  const state = activeEvents.get(key);

  if (!state || state.resolved) {
    await ctx.answerCbQuery('Событие уже закрыто.');
    return;
  }
  state.resolved = true;

  const reactionMs = Date.now() - state.startedAt;
  const correct = choice === state.correctChoice;
  const xp = correct ? 25 : 5;
  const coins = correct ? 50 : 10;

  await awardProgress(ctx.from.id, xp, coins);
  await recordEventResponse({
    eventId,
    telegramId: ctx.from.id,
    choice,
    correct,
    reactionMs,
    xpAwarded: xp,
    coinsAwarded: coins,
  });
  const unlocked = await checkAndUnlockAchievements(ctx.from.id);

  await ctx.answerCbQuery(correct ? '✅ Верное решение!' : '❌ Неверное решение');

  const resultLine = correct
    ? `✅ *Верное решение!* +${xp} XP, +${coins} 🪙`
    : `❌ *Неверное решение.* +${xp} XP, +${coins} 🪙`;

  const bonus = unlocked.length
    ? `\n\n🎖 Новое достижение: ${unlocked.map((a) => `${a.icon} ${a.title}`).join(', ')}`
    : '';

  await ctx.editMessageText(`🎮 *Событие #${eventId} завершено*\n\n${resultLine}${bonus}`, { parse_mode: 'Markdown' });
});

// ---------------------------------------------------------------------------
// Магазин: покупка
// ---------------------------------------------------------------------------

bot.action(/^buy:(.+)$/, async (ctx) => {
  const code = ctx.match[1];
  const result = await purchaseItem(ctx.from.id, code);

  if (!result.ok) {
    await ctx.answerCbQuery('Недостаточно RADAR COINS', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery('Покупка совершена!');
  await ctx.reply(`✅ Куплено: ${result.item.icon} ${result.item.title}`);
});

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------

async function setCommands() {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить RADAR' },
    { command: 'статус', description: 'Текущая обстановка' },
    { command: 'сводка', description: 'Краткая сводка' },
    { command: 'игра', description: 'Игровое событие' },
    { command: 'топ', description: 'Рейтинг операторов' },
    { command: 'профиль', description: 'Твой профиль' },
    { command: 'магазин', description: 'Магазин за coins' },
    { command: 'достижения', description: 'Достижения' },
    { command: 'помощь', description: 'Что делать при угрозе' },
    { command: 'команды', description: 'Список команд' },
  ]);
}

async function main() {
  await setCommands();

  if (process.env.BOT_MODE === 'webhook') {
    const domain = process.env.WEBHOOK_DOMAIN;
    const path = process.env.WEBHOOK_PATH || '/telegram-webhook';
    const port = Number(process.env.PORT) || 3000;
    await bot.launch({ webhook: { domain, hookPath: path, port } });
    console.log(`RADAR bot: webhook запущен на ${domain}${path} (port ${port})`);
  } else {
    await bot.launch();
    console.log('RADAR bot: polling запущен');
  }
}

main().catch((err) => {
  console.error('Не удалось запустить бота:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
