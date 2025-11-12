export class AudioManager {
  constructor() {
    this.sounds = new Map();
    this.enabled = true;
    this.volume = 0.5;
    this.loadSounds();
  }

  loadSounds() {
    this.sounds.set('move', this.createAudioContext('move'));
    this.sounds.set('win', this.createAudioContext('win'));
    this.sounds.set('lose', this.createAudioContext('lose'));
    this.sounds.set('draw', this.createAudioContext('draw'));
    this.sounds.set('notification', this.createAudioContext('notification'));
    this.sounds.set('click', this.createAudioContext('click'));
  }

  createAudioContext(type) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Простые синтезированные звуки
    const frequencies = {
      move: 440,
      win: 523,
      lose: 220,
      draw: 330,
      notification: 880,
      click: 660
    };

    return {
      context: audioContext,
      frequency: frequencies[type] || 440
    };
  }

  play(type, duration = 100) {
    if (!this.enabled) return;

    const sound = this.sounds.get(type);
    if (!sound) return;

    try {
      const oscillator = sound.context.createOscillator();
      const gainNode = sound.context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(sound.context.destination);

      oscillator.frequency.setValueAtTime(sound.frequency, sound.context.currentTime);
      oscillator.type = type === 'click' ? 'square' : 'sine';

      gainNode.gain.setValueAtTime(0, sound.context.currentTime);
      gainNode.gain.linearRampToValueAtTime(this.volume * 0.1, sound.context.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, sound.context.currentTime + duration / 1000);

      oscillator.start(sound.context.currentTime);
      oscillator.stop(sound.context.currentTime + duration / 1000);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  playMove() {
    this.play('move', 150);
  }

  playWin() {
    this.play('win', 500);
    setTimeout(() => this.play('win', 300), 200);
  }

  playLose() {
    this.play('lose', 800);
  }

  playDraw() {
    this.play('draw', 300);
    setTimeout(() => this.play('draw', 300), 150);
  }

  playNotification() {
    this.play('notification', 200);
  }

  playClick() {
    this.play('click', 50);
  }
}

export const audioManager = new AudioManager();