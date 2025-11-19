import crypto from 'crypto';

export function validateTelegramWebAppData(initData) {
  if (!initData) return false;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Поддерживаем оба имени переменной
  const BOT = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
  if (!BOT) return false;

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(BOT)
    .digest();

  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return calculatedHash === hash;
}

export function extractUserData(initData) {
  if (!validateTelegramWebAppData(initData)) return null;

  const urlParams = new URLSearchParams(initData);
  const userParam = urlParams.get('user');

  if (!userParam) return null;

  try {
    const user = JSON.parse(userParam);
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      photo_url: user.photo_url,
      is_bot: user.is_bot
    };
  } catch {
    return null;
  }
}
