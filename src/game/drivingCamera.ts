import { VIEW_HALF_HEIGHT } from './impactCamera';

interface DrivingFrame {
  speed: number;
  height: number;
  verticalSpeed: number;
  grounded: boolean;
  loopView: number;
  crashed: boolean;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Anticipate the rise of a jump, then ease back after landing or slowing down.
 * Impact/crash zoom remains a separate layer over this wider driving view. */
export class DrivingCamera {
  halfHeight = VIEW_HALF_HEIGHT;
  lift = 0;
  private wasCrashed = false;

  update(frame: DrivingFrame, delta: number): void {
    if (frame.crashed) { this.wasCrashed = true; return; }
    if (this.wasCrashed) {
      this.halfHeight = VIEW_HALF_HEIGHT;
      this.lift = 0;
      this.wasCrashed = false;
    }
    const ordinary = 1 - frame.loopView;
    const speed = clamp((Math.abs(frame.speed) - 21) / 13);
    const speedRoom = speed * speed * (3 - 2 * speed) * 7;
    const height = frame.grounded ? 0 : Math.max(0, frame.height);
    // A little upward look-ahead starts widening before the car reaches its apex.
    const predictedHeight = height + (frame.grounded ? 0 : Math.max(0, frame.verticalSpeed) * .6);
    const jumpRoom = Math.max(0, predictedHeight - 4) * .55;
    const targetHeight = VIEW_HALF_HEIGHT + frame.loopView * 1.7 + Math.max(speedRoom, jumpRoom) * ordinary;
    const targetLift = Math.max(0, height - 3) * .45 * ordinary;
    const dt = Math.max(0, delta);
    const zoomEase = 1 - Math.exp(-dt * (targetHeight > this.halfHeight ? 4.2 : 1.8));
    this.halfHeight += (targetHeight - this.halfHeight) * zoomEase;
    this.lift += (targetLift - this.lift) * (1 - Math.exp(-dt * 4.2));
  }
}
