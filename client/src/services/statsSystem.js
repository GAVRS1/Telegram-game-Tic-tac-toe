import { isNumericId } from "../utils/identity.js";

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export class StatsSystem {
  constructor(getMe) {
    this.getMe = getMe;
    this.serverProfile = null;
    this.serverError = null;
    this.lastServerSync = 0;
    this.loadingServer = false;
    this.serverSyncTimer = null;

    this.currentGame = {
      startTime: null,
      moves: 0,
      positions: [],
      active: false,
    };

    this.queueServerSync(0);
  }

  queueServerSync(delay = 400) {
    const me = this.getMe?.();
    if (!isNumericId(me?.id)) return;
    if (this.serverSyncTimer) clearTimeout(this.serverSyncTimer);
    this.serverSyncTimer = setTimeout(() => {
      this.serverSyncTimer = null;
      this.ensureServerStats({ force: true }).catch(() => {});
    }, Math.max(0, delay));
  }

  async ensureServerStats({ force = false } = {}) {
    const me = this.getMe?.();
    const id = me?.id;
    if (!isNumericId(id)) {
      this.serverProfile = null;
      this.serverError = null;
      return { profile: null, error: null };
    }

    const now = Date.now();
    if (!force && this.loadingServer) {
      return { profile: this.serverProfile, error: this.serverError };
    }
    if (!force && this.serverProfile && now - this.lastServerSync < 5000) {
      return { profile: this.serverProfile, error: this.serverError };
    }

    this.loadingServer = true;
    try {
      const response = await fetch(`/profile/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const profile = data?.profile ?? null;
      this.applyServerStats(profile);
      this.serverError = null;
      this.lastServerSync = Date.now();
      return { profile, error: null };
    } catch (error) {
      this.serverError = error;
      return { profile: this.serverProfile, error };
    } finally {
      this.loadingServer = false;
    }
  }

  applyServerStats(profile) {
    this.serverProfile = profile || null;
  }

  startGame() {
    this.currentGame = {
      startTime: Date.now(),
      moves: 0,
      positions: [],
      active: true,
    };
  }

  recordMove(position) {
    if (!this.currentGame.active) return;
    this.currentGame.moves += 1;
    if (position !== undefined && position !== null) {
      this.currentGame.positions.push(position);
    }
  }

  endGame() {
    if (!this.currentGame.active) {
      this.queueServerSync();
      return;
    }

    this.queueServerSync();

    this.currentGame = {
      startTime: null,
      moves: 0,
      positions: [],
      active: false,
    };
  }

  getSummary() {
    const profile = this.serverProfile;
    if (!profile) {
      return {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
      };
    }

    const wins = normalizeNumber(profile.wins);
    const losses = normalizeNumber(profile.losses);
    const draws = normalizeNumber(profile.draws);
    const gamesFromDb = normalizeNumber(profile.games_played);
    const games = gamesFromDb > 0 ? gamesFromDb : wins + losses + draws;

    let winRate = normalizeNumber(profile.win_rate);
    if (!winRate && games > 0) {
      winRate = Math.round((wins / games) * 100);
    }

    return {
      gamesPlayed: games,
      wins,
      losses,
      draws,
      winRate,
    };
  }

  async loadProfile({ force = false } = {}) {
    const { profile, error } = await this.ensureServerStats({ force });
    return { profile, summary: this.getSummary(), error };
  }

  reset() {
    this.serverProfile = null;
    this.serverError = null;
    this.lastServerSync = 0;
  }
}
