export class AnimationController {
  constructor() {
    this.animations = new Map();
  }

  // Анимация появления клетки
  animateCellAppear(cell, delay = 0) {
    cell.style.opacity = '0';
    cell.style.transform = 'scale(0.8)';
    
    setTimeout(() => {
      cell.style.transition = 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
      cell.style.opacity = '1';
      cell.style.transform = 'scale(1)';
    }, delay);
  }

  // Анимация победной линии
  animateWinLine(line) {
    line.forEach((cellIndex, index) => {
      const cell = document.querySelector(`[data-i="${cellIndex}"]`);
      if (cell) {
        setTimeout(() => {
          cell.classList.add('win-animation');
        }, index * 100);
      }
    });
  }

  // Анимация сдачи
  animateResign() {
    const board = document.getElementById('board');
    board.style.animation = 'shake 0.5s ease-in-out';
    
    setTimeout(() => {
      board.style.animation = '';
    }, 500);
  }

  // Плавное исчезновение
  fadeOut(element, duration = 300) {
    element.style.transition = `opacity ${duration}ms ease-out`;
    element.style.opacity = '0';
    
    return new Promise(resolve => {
      setTimeout(() => {
        element.style.display = 'none';
        resolve();
      }, duration);
    });
  }

  // Плавное появление
  fadeIn(element, duration = 300) {
    element.style.display = '';
    element.style.opacity = '0';
    element.style.transition = `opacity ${duration}ms ease-in`;
    
    requestAnimationFrame(() => {
      element.style.opacity = '1';
    });
  }
}