// input.js —— 键盘输入
export class Input {
  constructor() {
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  has(code) { return this.keys.has(code); }

  // 每帧采样
  sample() {
    return {
      throttle: (this.has('KeyW') || this.has('ArrowUp')) ? 1 : 0,
      brake: (this.has('KeyS') || this.has('ArrowDown')) ? 1 : 0,
      steer: ((this.has('KeyA') || this.has('ArrowLeft')) ? 1 : 0) -
             ((this.has('KeyD') || this.has('ArrowRight')) ? 1 : 0),
      handbrake: this.has('Space'),
    };
  }
}
