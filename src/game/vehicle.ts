/** Shared dimensions in world metres for the car's model and tire support. */
export const CAR_WHEEL_RADIUS = 0.43;
export const CAR_WHEEL_OFFSET = 1.275;
export const CAR_AXLE_Y = -0.27;
export const CAR_ARCH_RADIUS = 0.57;
/** Body motion stays inside the tire openings even at full compression. */
export const CAR_SUSPENSION_TRAVEL = 0.045;
export const CAR_SUSPENSION_PITCH = 0.025;
export const CAR_BODY_CLEARANCE = CAR_WHEEL_RADIUS - CAR_AXLE_Y;
