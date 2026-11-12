// Turns raw XInput readings into "the user touched the controller at time T".
//
// XInput's packet number can't be used for this: it also changes on analog noise,
// so a worn stick would keep the PC "active" forever. Instead each reading is
// compared with the last one that counted, ignoring the standard dead zones.

export interface GamepadState {
  buttons: number;
  leftTrigger: number;
  rightTrigger: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export type GamepadReader = (slot: number) => GamepadState | null;

// Microsoft's documented XInput values.
const LEFT_STICK_DEADZONE = 7849;
const RIGHT_STICK_DEADZONE = 8689;
const TRIGGER_THRESHOLD = 30;
/** About 10% of the stick's range. Compared against the baseline, so slow moves add up. */
const STICK_MOVEMENT = 3000;

const MAX_SLOTS = 4;
/** A missing controller needs only an occasional check, one slot at a time. */
const DISCONNECTED_CHECK_EVERY = 25;

function stickDistance(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  deadzone: number,
): number {
  const settle = (x: number, y: number): [number, number] =>
    Math.hypot(x, y) < deadzone ? [0, 0] : [x, y];
  const [ax, ay] = settle(x1, y1);
  const [bx, by] = settle(x2, y2);
  return Math.hypot(ax - bx, ay - by);
}

export function isGamepadActivity(baseline: GamepadState, current: GamepadState): boolean {
  return (
    baseline.buttons !== current.buttons ||
    Math.abs(baseline.leftTrigger - current.leftTrigger) > TRIGGER_THRESHOLD ||
    Math.abs(baseline.rightTrigger - current.rightTrigger) > TRIGGER_THRESHOLD ||
    stickDistance([baseline.leftX, baseline.leftY], [current.leftX, current.leftY], LEFT_STICK_DEADZONE) > STICK_MOVEMENT ||
    stickDistance([baseline.rightX, baseline.rightY], [current.rightX, current.rightY], RIGHT_STICK_DEADZONE) > STICK_MOVEMENT
  );
}

export class GamepadMonitor {
  private readonly read: GamepadReader;
  /** undefined: not checked yet. null: nothing connected. */
  private readonly baselines: Array<GamepadState | null | undefined>;
  private polls = 0;
  private lastActivity: number | null = null;

  constructor(read: GamepadReader) {
    this.read = read;
    this.baselines = new Array<undefined>(MAX_SLOTS).fill(undefined);
  }

  get lastActivityAt(): number | null {
    return this.lastActivity;
  }

  get connectedCount(): number {
    return this.baselines.filter(Boolean).length;
  }

  poll(now: number): void {
    const check = this.polls % DISCONNECTED_CHECK_EVERY;
    this.polls++;

    this.baselines.forEach((baseline, slot) => {
      if (baseline === null && check !== slot) return;

      const current = this.read(slot);
      if (current === null) {
        this.baselines[slot] = null;
      } else if (baseline === undefined) {
        // A controller already there at startup says nothing about the user.
        this.baselines[slot] = current;
      } else if (baseline === null || isGamepadActivity(baseline, current)) {
        // Plugging in or switching on a controller also counts as being here.
        this.baselines[slot] = current;
        this.lastActivity = now;
      }
    });
  }
}
