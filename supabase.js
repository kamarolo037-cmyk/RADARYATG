import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Заполните SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env');
}

// service_role ключ — используется ТОЛЬКО на сервере бота, никогда в Mini App / клиенте.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const RANK_TITLES = {
  recruit: 'Новобранец',
  operator2: 'Оператор II класса',
  operator1: 'Оператор I класса',
  sergeant: 'Сержант',
  commander: 'Командир',
};

export async function ensureProfile(from) {
  const { id, username, first_name, last_name } = from;
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_id', id)
    .maybeSingle();

  if (existing) {
    // держим username/имя в актуальном состоянии
    await supabase
      .from('profiles')
      .update({ username: username ?? existing.username, first_name: first_name ?? existing.first_name })
      .eq('telegram_id', id);
    return { ...existing, username: username ?? existing.username, first_name: first_name ?? existing.first_name };
  }

  const { data: created, error } = await supabase
    .from('profiles')
    .insert({
      telegram_id: id,
      username: username ?? null,
      first_name: first_name || [first_name, last_name].filter(Boolean).join(' ') || 'Оператор',
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
}

export async function registerChat(chat) {
  await supabase
    .from('chats')
    .upsert({ chat_id: chat.id, chat_type: chat.type, title: chat.title ?? null }, { onConflict: 'chat_id' });
}

export async function getCurrentStatus() {
  const { data } = await supabase
    .from('status_reports')
    .select('*')
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    data ?? {
      state: 'СПОКОЙНО',
      activity_level: 'низкая',
      summary_bullets: ['Данные пока не загружены оператором.'],
      source_note: 'Информация предоставляется на основе официальных и проверенных источников.',
      created_at: new Date().toISOString(),
    }
  );
}

export async function getLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .from('profiles')
    .select('telegram_id, username, first_name, xp, level')
    .order('xp', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getUserRankPosition(telegramId) {
  // Позиция среди всех операторов по XP (1-based)
  const { data, error } = await supabase
    .from('profiles')
    .select('telegram_id, xp')
    .order('xp', { ascending: false });
  if (error) throw error;
  const idx = data.findIndex((p) => p.telegram_id === telegramId);
  return { position: idx + 1, total: data.length };
}

export async function pickRandomEvent() {
  const { data, error } = await supabase.from('game_events').select('*');
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

export async function awardProgress(telegramId, xp, coins) {
  const { data, error } = await supabase.rpc('award_progress', {
    p_telegram_id: telegramId,
    p_xp: xp,
    p_coins: coins,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function recordEventResponse({ eventId, telegramId, choice, correct, reactionMs, xpAwarded, coinsAwarded }) {
  await supabase.from('event_responses').insert({
    event_id: eventId,
    telegram_id: telegramId,
    choice,
    correct,
    reaction_ms: reactionMs ?? null,
    xp_awarded: xpAwarded,
    coins_awarded: coinsAwarded,
  });

  await supabase
    .from('profiles')
    .update({
      events_total: (await currentValue(telegramId, 'events_total')) + 1,
      correct_calls: correct ? (await currentValue(telegramId, 'correct_calls')) + 1 : undefined,
    })
    .eq('telegram_id', telegramId);
}

async function currentValue(telegramId, column) {
  const { data } = await supabase.from('profiles').select(column).eq('telegram_id', telegramId).single();
  return data?.[column] ?? 0;
}

export async function getAchievementsWithProgress(telegramId) {
  const { data: achievements } = await supabase.from('achievements').select('*').order('sort_order');
  const { data: unlocked } = await supabase
    .from('user_achievements')
    .select('*')
    .eq('telegram_id', telegramId);

  const unlockedMap = new Map((unlocked ?? []).map((u) => [u.achievement_code, u]));
  return (achievements ?? []).map((a) => ({
    ...a,
    unlocked: !!unlockedMap.get(a.code)?.unlocked_at,
    progress: unlockedMap.get(a.code)?.progress ?? 0,
  }));
}

export async function checkAndUnlockAchievements(telegramId) {
  const { data: profile } = await supabase.from('profiles').select('*').eq('telegram_id', telegramId).single();
  if (!profile) return [];

  const { data: achievements } = await supabase.from('achievements').select('*');
  const { data: unlockedRows } = await supabase
    .from('user_achievements')
    .select('achievement_code')
    .eq('telegram_id', telegramId)
    .not('unlocked_at', 'is', null);

  const alreadyUnlocked = new Set((unlockedRows ?? []).map((r) => r.achievement_code));
  const newlyUnlocked = [];

  for (const a of achievements ?? []) {
    if (alreadyUnlocked.has(a.code)) continue;
    let value = 0;
    if (a.requirement_type === 'events_total') value = profile.events_total;
    else if (a.requirement_type === 'correct_calls') value = profile.correct_calls;
    else if (a.requirement_type === 'streak_days') value = profile.streak_days;
    else continue; // 'top1' и 'reaction_time' проверяются отдельно (не здесь)

    if (value >= a.requirement_value) {
      await supabase.from('user_achievements').upsert(
        { telegram_id: telegramId, achievement_code: a.code, progress: value, unlocked_at: new Date().toISOString() },
        { onConflict: 'telegram_id,achievement_code' }
      );
      await awardProgress(telegramId, a.xp_reward, a.coins_reward);
      newlyUnlocked.push(a);
    } else {
      await supabase.from('user_achievements').upsert(
        { telegram_id: telegramId, achievement_code: a.code, progress: value },
        { onConflict: 'telegram_id,achievement_code' }
      );
    }
  }
  return newlyUnlocked;
}

export async function getShopItems() {
  const { data } = await supabase.from('shop_items').select('*').eq('active', true).order('sort_order');
  return data ?? [];
}

export async function purchaseItem(telegramId, itemCode) {
  const { data: item } = await supabase.from('shop_items').select('*').eq('code', itemCode).single();
  const { data: profile } = await supabase.from('profiles').select('coins').eq('telegram_id', telegramId).single();

  if (!item || !profile) throw new Error('not_found');
  if (profile.coins < item.price_coins) return { ok: false, reason: 'insufficient_coins', item };

  await supabase.from('profiles').update({ coins: profile.coins - item.price_coins }).eq('telegram_id', telegramId);
  await supabase.from('user_purchases').insert({ telegram_id: telegramId, item_code: itemCode });

  return { ok: true, item };
}
