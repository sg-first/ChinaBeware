// input.js —— 键盘 + 手柄 输入
// 手柄轮询参考 RainBlood2-ARPG 的 core.js：
//   仅在每帧 beginFrame() 时读取一次 gamepad 状态，键盘与手柄统一合并成"动作"。

// 手柄 → 赛车动作 映射（标准 XInput 布局）
//   左摇杆 X      → 转向（模拟，带死区）
//   右扳机 RT(7)  → 油门（模拟）
//   左扳机 LT(6)  → 刹车 / 倒车（模拟）
//   A(0) / LB(4)/RB(5) → 手刹漂移
//   Y(3)          → 切换第一/第三人称视角
//   Start(9)      → 重新开始
//   D-pad(12/13/14/15) → 油门/刹车/左/右 兜底
const STICK_DEADZONE = 0.15;

export class Input {
  constructor() {
    this.keys = new Set();
    this.gamepadIndex = null;

    this._gpPrev = {};       // 上一帧手柄按键边沿状态
    this._actionPrev = {};   // 上一帧"动作按下"状态（键盘+手柄合并）
    this._edges = {};        // 本帧刚按下的动作（边沿触发）

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  has(code) { return this.keys.has(code); }
  get gamepadConnected() { return this.gamepadIndex !== null; }

  _gamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] || null;
  }
  _gpBtn(gp, i) {
    const b = gp.buttons[i];
    return b ? (b.pressed || b.value > 0.5) : false;
  }

  /* 每帧开头调用：刷新手柄状态、计算边沿动作 */
  beginFrame() {
    this._edges = {};

    // 键盘部分的动作（与手柄合并做边沿检测）
    const kbFirstPerson = this.has('KeyC') || this.has('KeyV');
    const kbRestart = this.has('KeyR');

    const gp = this._gamepad();
    let gpFirstPerson = false, gpRestart = false;
    if (gp) {
      gpFirstPerson = this._gpBtn(gp, 3);   // Y
      gpRestart = this._gpBtn(gp, 9);       // Start
    }

    this._updateActionEdge('firstPerson', kbFirstPerson || gpFirstPerson);
    this._updateActionEdge('restart', kbRestart || gpRestart);

    // 开始 / 重开（开始界面、结束界面使用）：键盘 Enter + 手柄 A(0)
    const kbConfirm = this.has('Enter');
    const gpConfirm = gp ? this._gpBtn(gp, 0) : false;
    this._updateActionEdge('confirm', kbConfirm || gpConfirm);
  }

  _updateActionEdge(action, down) {
    if (down && !this._actionPrev[action]) this._edges[action] = true;
    this._actionPrev[action] = down;
  }

  /* 本帧刚按下（边沿触发），键盘 / 手柄通用 */
  pressed(action) { return !!this._edges[action]; }

  /* 每帧采样：合并键盘与手柄，返回驾驶控制 */
  sample() {
    let throttle = (this.has('KeyW') || this.has('ArrowUp')) ? 1 : 0;
    let brake = (this.has('KeyS') || this.has('ArrowDown')) ? 1 : 0;
    let steer = ((this.has('KeyA') || this.has('ArrowLeft')) ? 1 : 0) -
                ((this.has('KeyD') || this.has('ArrowRight')) ? 1 : 0);
    let handbrake = this.has('Space');

    const gp = this._gamepad();
    if (gp) {
      // 左摇杆 X：模拟转向（带死区，平滑由车辆自己处理）
      // 注意符号与键盘约定一致：A/左 = +1（左转），故右推摇杆(ax>0)应得 -1（右转）
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > STICK_DEADZONE) steer = -ax;

      // 右扳机油门 / 左扳机刹车（模拟量，取键盘与手柄中的较大值）
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);

      // A / LB / RB = 手刹
      if (this._gpBtn(gp, 0) || this._gpBtn(gp, 4) || this._gpBtn(gp, 5)) handbrake = true;

      // D-pad 兜底（符号与键盘一致：左=+1，右=-1）
      if (this._gpBtn(gp, 12)) throttle = 1;
      if (this._gpBtn(gp, 13)) brake = 1;
      if (this._gpBtn(gp, 14)) steer = 1;
      if (this._gpBtn(gp, 15)) steer = -1;
    }

    return { throttle, brake, steer, handbrake };
  }
}
