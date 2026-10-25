type TouchIcon = 'jump' | 'fire' | 'boost' | 'aim' | 'suction' | 'front-jet' | 'rear-jet';

const car = '<path d="M5 16v-3l2-3h9l3 3v3M5 13h14M9 16h6"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/>';
const flip = `${car}<path d="M20 8a9 9 0 0 0-15-2M5 2v4h4"/>`;
const paths: Record<TouchIcon, string> = {
  jump: '<path d="M12 16V3M7 8l5-5 5 5M5 21h14M5 17v1m14-1v1"/>',
  fire: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  boost: '<path d="M13 2c1 6-4 6-4 10-2-1-2-3-2-3-3 3-3 5-3 7a8 8 0 0 0 16 0c0-5-3-10-7-14Z"/><path d="M12 13c0 3-3 3-3 5a3 3 0 0 0 6 0c0-2-1-4-3-5Z"/>',
  aim: '<path d="M5 9h9v5H5zm9 1h6v3h-6M8 14v4M3 6a11 11 0 0 1 17-1m0-3v3h-3M21 18a11 11 0 0 1-17 1m0 3v-3h3"/>',
  suction: '<path d="M5 13V9a7 7 0 0 1 14 0v4h-4V9a3 3 0 0 0-6 0v4ZM5 10h4m6 0h4M12 14v4m-3-3 3 3 3-3M4 22h16"/>',
  'front-jet': flip,
  'rear-jet': `<g transform="translate(24 0) scale(-1 1)">${flip}</g>`,
};

/** A consistent outline set remains sharp at every editable button size. */
export function touchIcon(id: TouchIcon): string {
  return `<svg class="touch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[id]}</svg>`;
}
