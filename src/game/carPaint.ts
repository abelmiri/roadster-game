export const CAR_PAINT_PRICE = 50;
export const CAR_PAINTS = [
  { id: 'blue', color: '#3185f5' },
  { id: 'pink', color: '#f46cba' },
  { id: 'red', color: '#ef414b' },
  { id: 'black', color: '#252c36' },
  { id: 'purple', color: '#9854e8' },
  { id: 'yellow', color: '#ffda3c' },
  { id: 'lime', color: '#b3ff36' },
  { id: 'silver', color: '#bfcbd5' },
  { id: 'orange', color: '#ff8b36' },
  { id: 'teal', color: '#32d5cb' },
  { id: 'gold', color: '#dcae4f' },
  { id: 'burgundy', color: '#a82d55' },
] as const;
export type CarPaintId = 'white' | typeof CAR_PAINTS[number]['id'];
export const ALL_CAR_PAINTS = [{ id: 'white', color: '#f3f4ee' }, ...CAR_PAINTS] as const;
export function isCarPaint(id: unknown): id is CarPaintId {
  return ALL_CAR_PAINTS.some(paint => paint.id === id);
}

/** The same facets color both the garage preview and the physical car. */
export function carPaintPalette(id: string): { base: string; top: string; pale: string; shade: string } {
  const paint = ALL_CAR_PAINTS.find(paint => paint.id === id) ?? ALL_CAR_PAINTS[0];
  if (paint.id === 'white') return { base: paint.color, top: '#ffffff', pale: '#d3d8d9', shade: '#b3bdc5' };
  const tint = (amount: number): string => '#' + [1, 3, 5].map(start => {
    const value = parseInt(paint.color.slice(start, start + 2), 16);
    return Math.round(amount > 0 ? value + (255 - value) * amount : value * (1 + amount)).toString(16).padStart(2, '0');
  }).join('');
  return { base: paint.color, top: tint(.22), pale: tint(-.12), shade: tint(-.32) };
}
