/** Cumulative front guard, door plate, roof cap and rear guard from the reference. */
export const ARMOR_PARTS: ReadonlyArray<{
  name: string; center: [number, number]; points: [number, number][]; bolts: [number, number][]; depth: number; z: number;
}> = [
  { name: 'front', center: [2.15, -.19], depth: 1.12, z: -.56,
    points: [[1.98,.16],[2.22,.12],[2.35,-.47],[2.40,-.57],[2.14,-.51],[2.08,-.40],[2.19,-.40],[2.08,.02],[1.97,.04]],
    bolts: [[2.13,.07],[2.24,-.40]] },
  { name: 'door', center: [-.03, -.07], depth: .14, z: .55,
    points: [[-.61,.28],[.58,.17],[.55,-.37],[-.66,-.31]],
    bolts: [[-.55,.21],[.50,.10],[.46,-.30],[-.57,-.25]] },
  { name: 'roof', center: [-.03, .69], depth: 1.08, z: -.54,
    points: [[-.67,.61],[-.55,.75],[-.40,.80],[.39,.75],[.62,.58],[.43,.60],[-.42,.65]],
    bolts: [[-.48,.70],[.33,.67]] },
  { name: 'rear', center: [-2.12, -.14], depth: 1.10, z: -.55,
    points: [[-2.13,.17],[-1.98,.12],[-1.97,-.41],[-2.20,-.45],[-2.27,-.30],[-2.23,.02]],
    bolts: [[-2.10,.05],[-2.13,-.31]] },
];
