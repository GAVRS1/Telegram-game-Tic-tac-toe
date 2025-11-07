export class NotificationSystem {
  constructor() {
    this.container = this.createContainer();
    this.notifications = new Map();
    this.notificationId = 0;
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(container);
    return container;
  }

  show(message, type = 'info', duration = 3000) {
    const id = ++this.notificationId;
    const notification = this.createNotification(message, type, id);
    
    this.container.appendChild(notification);
    this.notifications.set(id, notification);

    // Анимация появления
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });

    // Автоматическое исчезновение
    if (duration > 0) {
      setTimeout(() => {
        this.hide(id);
      }, duration);
    }

    return id;
  }

  createNotification(message, type, id) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${this.escapeHtml(message)}</span>
        <button class="notification-close" onclick="notificationSystem.hide(${id})">×</button>
      </div>
    `;
    
    return notification;
  }

  hide(id) {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.classList.remove('show');
      notification.classList.add('hide');
      
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications.delete(id);
      }, 300);
    }
  }

  hideAll() {
    this.notifications.forEach((notification, id) => {
      this.hide(id);
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Утилиты для разных типов уведомлений
  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }
}

// Создание глобального экземпляра
export const notificationSystem = new NotificationSystem();