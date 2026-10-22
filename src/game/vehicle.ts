/** Shared dimensions in world metres for the car's model and tire support. */
export const CAR_WHEEL_RADIUS = 0.43;
export const CAR_WHEEL_OFFSET = 1.275;
export const CAR_AXLE_Y = -0.36;
export const CAR_ARCH_RADIUS = 0.65;
/** Body motion stays inside the tire openings even at full compression. */
export const CAR_SUSPENSION_TRAVEL = 0.17;
export const CAR_SUSPENSION_PITCH = Math.asin(CAR_SUSPENSION_TRAVEL / CAR_WHEEL_OFFSET);
export const CAR_BODY_CLEARANCE = CAR_WHEEL_RADIUS - CAR_AXLE_Y;

/** Suspension heave follows the car's local up axis, including inside loops. */
export function sprungBodyPose(car: { x: number; y: number; angle: number }, offset: number, pitch: number):
  { x: number; y: number; angle: number } {
  return { x: car.x - Math.sin(car.angle) * offset,
    y: car.y + Math.cos(car.angle) * offset, angle: car.angle + pitch };
}
