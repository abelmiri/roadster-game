import type { WeaponId } from './weapons';

/** Small original silhouettes for the armory, sharing the in-game palette. */
export function weaponIcon(id: WeaponId): string {
  const parts: Record<WeaponId, string> = {
    'machine-gun': '<path d="M78 25h66v7H78z" fill="#96a5b1"/><path d="M134 22h20v13h-20z" fill="#415565"/><path d="M139 25h3v7h-3m6-7h3v7h-3" stroke="#142430" stroke-width="3"/>',
    'twin-gun': '<path d="M77 18h76v8H77zm0 17h76v8H77z" fill="#91a4b3"/><path d="M143 20h13v4h-13m0 13h13v4h-13" stroke="#233441" stroke-width="4"/>',
    'gatling-gun': '<path d="M77 16h69v31H77z" fill="#374958"/><path d="M80 20h70m-70 9h70m-70 9h70m-70 7h70" stroke="#a9b7bf" stroke-width="4"/><ellipse cx="148" cy="32" rx="9" ry="19" fill="#617585"/><path d="M147 21v4m0 5v4m0 5v4" stroke="#172632" stroke-width="4"/>',
    'cannon': '<path d="M78 17h70v28H78z" fill="#a9b7c1"/><path d="M82 21h65v20H82z" fill="#8398a7"/><ellipse cx="149" cy="31" rx="9" ry="15" fill="#c1cdd3"/><ellipse cx="150" cy="31" rx="5" ry="9" fill="#243542"/>',
    'rocket-launcher': '<path d="M74 8h64l12 8v37H74z" fill="#e2e9eb"/><path d="M113 14h32v34h-32z" fill="#243543"/><g fill="#ed634c"><circle cx="121" cy="23" r="5"/><circle cx="136" cy="23" r="5"/><circle cx="121" cy="39" r="5"/><circle cx="136" cy="39" r="5"/></g>',
    'missile-launcher': '<path d="M74 21h55v20H74z" fill="#d8e1e6"/><path d="m128 19 27 12-27 12z" fill="#ed6246"/><path d="m79 15 18 6v20l-18 8z" fill="#a4b4c0"/><path d="M73 45h61v7H73z" fill="#41586a"/>',
    'laser-gun': '<path d="M77 17h66l10 10v17H77z" fill="#324959"/><path d="M88 26h48v9H88z" fill="#72fbef"/><path d="M147 27h7v12h-7z" fill="#72fbef"/>',
    'plasma-cannon': '<path d="M77 21h72v23H77z" fill="#4b4767"/><path d="M81 18v30m18-30v30m19-30v30" stroke="#c37bf8" stroke-width="6"/><ellipse cx="150" cy="33" rx="11" ry="19" fill="#65557e"/><ellipse cx="153" cy="33" rx="6" ry="11" fill="#eea0ff"/><path d="M42 23h26" stroke="#d38cff" stroke-width="4"/>',
  };
  return `<svg viewBox="0 0 180 70" fill="none" aria-hidden="true"><path d="M29 55h57l12 12H17z" fill="#536b7e"/><path d="M48 42h20v15H48z" fill="#384d60"/><path d="m29 16 10-8h38v41H29z" fill="#405768"/><path d="M34 18h13v18H34z" fill="#263e50"/><path d="M68 8h10v41H68z" fill="${id === 'gatling-gun' || id === 'cannon' ? '#e7b352' : '#d5dfe4'}"/>${parts[id]}</svg>`;
}
