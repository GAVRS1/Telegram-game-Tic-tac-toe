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

    const content = document.createElement('div');
    content.className = 'notification-content';

    const messageEl = document.createElement('span');
    messageEl.className = 'notification-message';
    messageEl.innerHTML = this.escapeHtml(message);

    const closeButton = document.createElement('button');
    closeButton.className = 'notification-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.hide(id));

    content.appendChild(messageEl);
    content.appendChild(closeButton);
    notification.appendChild(content);

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

export const notificationSystem = new NotificationSystem();