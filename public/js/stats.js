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
      positions: []
    };
    
    this.loadStats();
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

  startGame() {
    this.currentGame = {
      startTime: Date.now(),
      moves: 0,
      positions: []
    };
  }

  recordMove(position) {
    this.currentGame.moves++;
    this.currentGame.positions.push(position);
    this.stats.totalMoves++;
    
    // Отслеживание любимой позиции
    this.stats.favoritePosition[position] = 
      (this.stats.favoritePosition[position] || 0) + 1;
  }

  endGame(result) {
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

    switch (result) {
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
    
    // Обновить достижения
    if (window.achievementSystem) {
      if (result === 'win') {
        window.achievementSystem.onGameWon({
          moves: this.currentGame.moves,
          duration: gameDuration
        });
      } else if (result === 'lose') {
        window.achievementSystem.onGameLost();
      }
    }
  }

  getWinRate() {
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
    
    this.saveStats();
  }
}

// Создание глобального экземпляра
export const statsSystem = new StatsSystem();