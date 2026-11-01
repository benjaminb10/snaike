// Souris, clavier et tactile (joystick flottant + bouton boost).
export class Input {
  angle = 0;
  boost = false;
  private keyBoost = false;
  private mouseBoost = false;
  private touchBoost = false;
  private joyId: number | null = null;
  private joyX = 0;
  private joyY = 0;
  touchMode = false;
  onFirstInput: (() => void) | null = null;
  joystick = { active: false, x: 0, y: 0, dx: 0, dy: 0 };

  constructor(target: HTMLElement, boostBtn: HTMLElement) {
    addEventListener('mousemove', (e) => {
      if (this.touchMode) return;
      this.angle = Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2);
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) this.mouseBoost = true;
      this.first();
    });
    addEventListener('mouseup', () => (this.mouseBoost = false));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.keyBoost = true;
        this.first();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.keyBoost = false;
    });

    target.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false });
    target.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    target.addEventListener('touchend', (e) => this.touchEnd(e));
    target.addEventListener('touchcancel', (e) => this.touchEnd(e));
    boostBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchBoost = true;
      boostBtn.classList.add('on');
      this.first();
    }, { passive: false });
    const off = () => {
      this.touchBoost = false;
      boostBtn.classList.remove('on');
    };
    boostBtn.addEventListener('touchend', off);
    boostBtn.addEventListener('touchcancel', off);
  }

  private first() {
    this.onFirstInput?.();
  }

  private touchStart(e: TouchEvent) {
    e.preventDefault();
    this.touchMode = true;
    document.body.classList.add('touch');
    this.first();
    for (const t of Array.from(e.changedTouches)) {
      if (this.joyId === null) {
        this.joyId = t.identifier;
        this.joyX = t.clientX;
        this.joyY = t.clientY;
        this.joystick = { active: true, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
      } else {
        // Deuxième doigt n'importe où : boost.
        this.touchBoost = true;
      }
    }
  }

  private touchMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.joyId) continue;
      const dx = t.clientX - this.joyX;
      const dy = t.clientY - this.joyY;
      const d = Math.hypot(dx, dy);
      if (d > 6) this.angle = Math.atan2(dy, dx);
      // Le socle suit le doigt s'il s'éloigne trop : pas de "bout de course".
      const max = 60;
      if (d > max) {
        this.joyX = t.clientX - (dx / d) * max;
        this.joyY = t.clientY - (dy / d) * max;
      }
      this.joystick = { active: true, x: this.joyX, y: this.joyY, dx: t.clientX - this.joyX, dy: t.clientY - this.joyY };
    }
  }

  private touchEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.joystick = { ...this.joystick, active: false };
      } else {
        this.touchBoost = false;
      }
    }
  }

  update() {
    this.boost = this.keyBoost || this.mouseBoost || this.touchBoost;
  }
}
