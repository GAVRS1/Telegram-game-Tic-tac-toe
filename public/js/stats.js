import { me } from './state.js';

function isNumericId(id) {
  return typeof id === 'string' ? /^[0-9]+$/.test(id) : Number.isFinite(id);
}

export class StatsSystem {
  constructor() {
    this.stats = {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
      totalMoves: 0,
      fastestWin: null,
      longestGame: null,
      favoritePosition: {},
      winStreak: 0,
      bestWinStreak: 0,
      totalPlayTime: 0,
      lastGame: null
    };

    this.currentGame = {
      startTime: null,
      moves: 0,
      positions: [],
      active: false
    };

    this.serverStats = null;
    this.serverError = null;
    this.lastServerSync = 0;
    this.loadingServer = false;
    this.serverSyncTimer = null;

    this.loadStats();
    this.queueServerSync(0);
  }

  loadStats() {
    try {
      const saved = localStorage.getItem('tictactoe_stats');
      if (saved) {
        const data = JSON.parse(saved);
        this.stats = { ...this.stats, ...data };
      }
    } catch (error) {
      console.warn('Failed to load stats:', error);
    }
  }

  saveStats() {
    try {
      localStorage.setItem('tictactoe_stats', JSON.stringify(this.stats));
    } catch (error) {
      console.warn('Failed to save stats:', error);
    }
  }

  queueServerSync(delay = 400) {
    if (!isNumericId(me?.id)) return;
    if (this.serverSyncTimer) clearTimeout(this.serverSyncTimer);
    this.serverSyncTimer = setTimeout(() => {
      this.serverSyncTimer = null;
      this.ensureServerStats({ force: true }).catch(() => {});
    }, Math.max(0, delay));
  }

  async ensureServerStats({ force = false } = {}) {
    const id = me?.id;
    if (!isNumericId(id)) {
      this.serverStats = null;
      this.serverError = null;
      return { profile: null, error: null };
    }

    const now = Date.now();
    if (!force && this.loadingServer) {
      return { profile: this.serverStats, error: this.serverError };
    }
    if (!force && this.serverStats && now - this.lastServerSync < 5000) {
      return { profile: this.serverStats, error: this.serverError };
    }

    this.loadingServer = true;
    try {
      const response = await fetch(`/profile/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const profile = data?.profile ?? null;
      this.applyServerStats(profile);
      this.serverError = null;
      this.lastServerSync = Date.now();
      return { profile, error: null };
    } catch (error) {
      this.serverError = error;
      return { profile: this.serverStats, error };
    } finally {
      this.loadingServer = false;
    }
  }

  applyServerStats(profile) {
    this.serverStats = profile || null;
    if (!profile) return;
    this.stats.gamesPlayed = Number(profile.games_played ?? this.stats.gamesPlayed ?? 0);
    this.stats.gamesWon = Number(profile.wins ?? this.stats.gamesWon ?? 0);
    this.stats.gamesLost = Number(profile.losses ?? this.stats.gamesLost ?? 0);
    this.stats.gamesDrawn = Number(profile.draws ?? this.stats.gamesDrawn ?? 0);
    this.saveStats();
  }

  startGame() {
    this.currentGame = {
      startTime: Date.now(),
      moves: 0,
      positions: [],
      active: true
    };
  }

  recordMove(position) {
    if (!this.currentGame.active) return;
    this.currentGame.moves++;
    this.currentGame.positions.push(position);
    this.stats.totalMoves++;

    this.stats.favoritePosition[position] =
      (this.stats.favoritePosition[position] || 0) + 1;
  }

  endGame(result) {
    if (!this.currentGame.active) {
      this.queueServerSync();
      return;
    }

    this.currentGame.active = false;
    const gameDuration = this.currentGame.startTime ?
      Date.now() - this.currentGame.startTime : 0;

    this.stats.gamesPlayed++;
    this.stats.totalPlayTime += gameDuration;
    this.stats.lastGame = {
      result,
      moves: this.currentGame.moves,
      duration: gameDuration,
      timestamp: Date.now()
    };

    const normalized = result === 'loss' ? 'lose' : result;

    switch (normalized) {
      case 'win':
        this.stats.gamesWon++;
        this.stats.winStreak++;
        this.stats.bestWinStreak = Math.max(
          this.stats.bestWinStreak,
          this.stats.winStreak
        );

        if (!this.stats.fastestWin || this.currentGame.moves < this.stats.fastestWin) {
          this.stats.fastestWin = this.currentGame.moves;
        }
        break;

      case 'lose':
        this.stats.gamesLost++;
        this.stats.winStreak = 0;
        break;

      case 'draw':
        this.stats.gamesDrawn++;
        this.stats.winStreak = 0;
        break;
    }

    if (!this.stats.longestGame || gameDuration > this.stats.longestGame) {
      this.stats.longestGame = gameDuration;
    }

    this.saveStats();

    if (window.achievementSystem) {
      if (normalized === 'win') {
        window.achievementSystem.onGameWon({
          moves: this.currentGame.moves,
          duration: gameDuration
        });
      } else if (normalized === 'lose') {
        window.achievementSystem.onGameLost();
      }
    }

    this.queueServerSync();

    this.currentGame = {
      startTime: null,
      moves: 0,
      positions: [],
      active: false
    };
  }

  getWinRate() {
    if (this.serverStats && typeof this.serverStats.win_rate === 'number') {
      return this.serverStats.win_rate;
    }
    if (this.stats.gamesPlayed === 0) return 0;
    return Math.round((this.stats.gamesWon / this.stats.gamesPlayed) * 100);
  }

  getAverageGameTime() {
    if (this.stats.gamesPlayed === 0) return 0;
    return Math.round(this.stats.totalPlayTime / this.stats.gamesPlayed);
  }

  getAverageMovesPerGame() {
    if (this.stats.gamesPlayed === 0) return 0;
    return Math.round(this.stats.totalMoves / this.stats.gamesPlayed);
  }

  getFavoritePosition() {
    const positions = Object.entries(this.stats.favoritePosition);
    if (positions.length === 0) return null;

    return positions.reduce((a, b) =>
      this.stats.favoritePosition[a[0]] > this.stats.favoritePosition[b[0]] ? a : b
    )[0];
  }

  getStatsSummary() {
    return {
      gamesPlayed: this.stats.gamesPlayed,
      wins: this.stats.gamesWon,
      losses: this.stats.gamesLost,
      draws: this.stats.gamesDrawn,
      winRate: this.getWinRate(),
      currentStreak: this.stats.winStreak,
      bestStreak: this.stats.bestWinStreak,
      averageGameTime: this.getAverageGameTime(),
      averageMoves: this.getAverageMovesPerGame(),
      favoritePosition: this.getFavoritePosition(),
      fastestWin: this.stats.fastestWin,
      totalPlayTime: this.stats.totalPlayTime
    };
  }

  exportStats() {
    return {
      ...this.stats,
      summary: this.getStatsSummary(),
      exportedAt: new Date().toISOString()
    };
  }

  async loadProfile({ force = false } = {}) {
    const { profile, error } = await this.ensureServerStats({ force });
    return { profile, summary: this.getStatsSummary(), error };
  }

  importStats(data) {
    try {
      if (data && typeof data === 'object') {
        this.stats = { ...this.stats, ...data };
        this.saveStats();
        return true;
      }
    } catch (error) {
      console.warn('Failed to import stats:', error);
    }
    return false;
  }

  reset() {
    this.stats = {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
      totalMoves: 0,
      fastestWin: null,
      longestGame: null,
      favoritePosition: {},
      winStreak: 0,
      bestWinStreak: 0,
      totalPlayTime: 0,
      lastGame: null
    };

    this.serverStats = null;
    this.serverError = null;
    this.saveStats();
  }
}

export const statsSystem = new StatsSystem();
