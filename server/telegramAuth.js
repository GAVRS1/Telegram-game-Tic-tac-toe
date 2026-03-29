import crypto from 'crypto';

const DEFAULT_INITDATA_TTL_SEC = 600;

const getInitDataTtlSec = () => {
  const raw = process.env.TELEGRAM_INITDATA_TTL_SEC;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_INITDATA_TTL_SEC;
};

export function validateTelegramInitData(initData) {
  if (!initData) return { isValid: false, reason: 'empty_init_data' };

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Поддерживаем оба имени переменной
  const BOT = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
  if (!BOT) return { isValid: false, reason: 'missing_bot_token' };

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(BOT)
    .digest();

  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    return { isValid: false, reason: 'invalid_signature' };
  }

  const authDateRaw = urlParams.get('auth_date');
  const authDate = Number(authDateRaw);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    return { isValid: false, reason: 'invalid_auth_date' };
  }

  const ttlSec = getInitDataTtlSec();
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - authDate;

  if (ageSec > ttlSec) {
    return {
      isValid: false,
      reason: 'expired',
      authDate,
      ageSec,
      ttlSec,
    };
  }

  return {
    isValid: true,
    reason: 'ok',
    authDate,
    ageSec,
    ttlSec,
  };
}

export function validateTelegramWebAppData(initData) {
  return validateTelegramInitData(initData).isValid;
}

export function extractUserData(initData, options = {}) {
  const { skipValidation = false } = options;
  if (!skipValidation && !validateTelegramWebAppData(initData)) return null;

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
