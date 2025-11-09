export class AchievementSystem {
  constructor() {
    this.achievements = new Map([
      ['first_win', {
        name: 'Первая победа',
        description: 'Выиграйте свою первую игру',
        icon: '🏆',
        unlocked: false
      }],
      ['win_streak_3', {
        name: 'Победная серия',
        description: 'Выиграйте 3 игры подряд',
        icon: '🔥',
        unlocked: false,
        progress: 0,
        target: 3
      }],
      ['speed_demon', {
        name: 'Скоростной демон',
        description: 'Сделайте ход за 5 секунд',
        icon: '⚡',
        unlocked: false
      }],
      ['perfectionist', {
        name: 'Перфекционист',
        description: 'Выиграйте за 5 ходов',
        icon: '✨',
        unlocked: false
      }]
    ]);
    
    this.loadAchievements();
  }

  loadAchievements() {
    try {
      const saved = localStorage.getItem('tictactoe_achievements');
      if (saved) {
        const data = JSON.parse(saved);
        for (const [key, achievement] of Object.entries(data)) {
          if (this.achievements.has(key)) {
            Object.assign(this.achievements.get(key), achievement);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load achievements:', error);
    }
  }

  saveAchievements() {
    try {
      const data = Object.fromEntries(this.achievements);
      localStorage.setItem('tictactoe_achievements', JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save achievements:', error);
    }
  }

  unlock(achievementId, showNotification = true) {
    const achievement = this.achievements.get(achievementId);
    if (!achievement || achievement.unlocked) return false;

    achievement.unlocked = true;
    achievement.unlockedAt = new Date().toISOString();
    
    this.saveAchievements();

    if (showNotification) {
      this.showUnlockNotification(achievement);
    }

    return true;
  }

  updateProgress(achievementId, progress) {
    const achievement = this.achievements.get(achievementId);
    if (!achievement || achievement.unlocked) return;

    achievement.progress = progress;
    
    if (progress >= achievement.target) {
      this.unlock(achievementId);
    }
    
    this.saveAchievements();
  }

  incrementProgress(achievementId, amount = 1) {
    const achievement = this.achievements.get(achievementId);
    if (!achievement || achievement.unlocked) return;

    achievement.progress = (achievement.progress || 0) + amount;
    
    if (achievement.progress >= achievement.target) {
      this.unlock(achievementId);
    }
    
    this.saveAchievements();
  }

  showUnlockNotification(achievement) {
    // Используем систему уведомлений
    if (window.notificationSystem) {
      window.notificationSystem.success(
        `🏆 Достижение разблокировано: ${achievement.name}!`,
        5000
      );
    }

    // Вибрация на мобильных устройствах
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }

    // Звуковой эффект
    if (window.audioManager) {
      window.audioManager.playWin();
    }
  }

  getUnlockedAchievements() {
    return Array.from(this.achievements.values())
      .filter(a => a.unlocked);
  }

  getProgress() {
    const total = this.achievements.size;
    const unlocked = this.getUnlockedAchievements().length;
    return {
      total,
      unlocked,
      percentage: Math.round((unlocked / total) * 100)
    };
  }

  // Методы для отслеживания событий игры
  onGameWon(gameData) {
    this.unlock('first_win');
    this.incrementProgress('win_streak_3');
    
    if (gameData.moves <= 5) {
      this.unlock('perfectionist');
    }
  }

  onGameLost() {
    // Сброс прогресса победной серии при поражении
    const winStreak = this.achievements.get('win_streak_3');
    if (winStreak) {
      winStreak.progress = 0;
      this.saveAchievements();
    }
  }

  onFastMove(moveTime) {
    if (moveTime <= 5000) { // 5 секунд
      this.unlock('speed_demon');
    }
  }
}

// Создание глобального экземпляра
export const achievementSystem = new AchievementSystem();