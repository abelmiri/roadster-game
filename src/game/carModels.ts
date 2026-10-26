export type CarModelId = 'roadster' | 'samandster' | 'tibaster' | 'peugester';
export const CAR_MODEL_PRICE = 100;

/** Cosmetics share the proven chassis, paint collection and garage upgrades. */
export const CAR_MODELS: readonly { id: CarModelId; name: string; fa: string; roofLift: number }[] = [
  { id: 'roadster', name: 'Roadster', fa: 'رودستر', roofLift: 0 },
  { id: 'samandster', name: 'Samandster', fa: 'سمندستر', roofLift: .29 },
  { id: 'tibaster', name: 'Tibaster', fa: 'تیباستر', roofLift: .29 },
  { id: 'peugester', name: 'Peugester', fa: 'پژوستر', roofLift: .29 },
];

export function isCarModel(id: unknown): id is CarModelId {
  return CAR_MODELS.some(model => model.id === id);
}

export function carModel(id: string) {
  return CAR_MODELS.find(model => model.id === id) ?? CAR_MODELS[0];
}
