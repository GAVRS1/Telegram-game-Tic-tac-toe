import crypto from "crypto";

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_REFERRAL_LENGTH = 8;

export function normalizeReferralCode(code) {
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase();
}

function generateReferralCandidate(length = DEFAULT_REFERRAL_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return out;
}

export async function generateUniqueReferralCode(db, { maxAttempts = 20, length = DEFAULT_REFERRAL_LENGTH } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateReferralCandidate(length);
    const { rowCount } = await db.query(`SELECT 1 FROM users WHERE ref_code = $1 LIMIT 1;`, [candidate]);
    if (rowCount === 0) return candidate;
  }
  throw new Error("Unable to generate unique referral code");
}
