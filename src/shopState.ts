export const SHOP_STATES = ['locked', 'available', 'owned', 'selected', 'complete'] as const;
export type ShopState = typeof SHOP_STATES[number];

export function shopStateIcon(state: ShopState): string {
  const paths = state === 'locked'
    ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'
    : state === 'available'
      ? '<path d="M5 8h14l1 13H4L5 8ZM8 8V6a4 4 0 0 1 8 0v2M9 14h6m-3-3v6"/>'
      : '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>';
  return `<svg class="shop-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function shopBadge(id: string): string {
  return `<span id="${id}" class="shop-badge" aria-hidden="true"><span id="${id}-icon" class="shop-badge-symbol"></span><span id="${id}-label" class="shop-badge-label"></span></span>`;
}
