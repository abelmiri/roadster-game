import { ARMOR_PARTS } from './armorParts';
import { carUpgradeLevel } from './carUpgrades';
import { carPaintPalette } from './carPaint';
import { carModel, type CarModelId } from './carModels';

/** Code-native preview shares the armor silhouettes with the in-game meshes. */
export function carGarageIcon(armorLevel: number, paint = 'white', vehicle: CarModelId = 'roadster'): string {
  const palette = carPaintPalette(paint);
  const body = vehicle === 'peugester' ? `
    <path d="M-2.04-.43V-.15L-2.00.15-1.86.37-1.63.58-1.30.75-.92.83-.55.84-.14.80.23.68.68.46 1.14.35 1.58.32 1.86.17 2.01-.04 2.04-.32 2.02-.43H1.916a.65.65 0 1 1-1.282 0H-.634a.65.65 0 1 1-1.282 0Z" fill="${palette.base}" stroke="${palette.top}" stroke-width=".018"/>
    <path d="M-.62.24 .62.20 .59-.32-.61-.32Z" fill="${palette.pale}"/><path d="M-.62-.34 .61-.34 .62-.43-.63-.43Z" fill="${palette.shade}"/>
    <path d="M-1.66.40-1.48.57-1.19.70-.92.75-.47.75-.43.30-1.37.31-1.59.34Z M-.35.75-.15.72.17.62.57.43.98.35-.32.29Z" fill="#101c26"/>
    <path d="M-1.49.44-1.35.57-1.12.66-.93.70-.53.70-.52.59-.98.62-1.30.53Z M-.28.69-.14.67.15.58.48.43.71.38-.29.54Z" fill="#354851"/>
    <path d="M-1.29.76-.92.83-.55.84-.14.80.23.68.17.62-.15.75-.55.79-.94.78Z M-.46.77-.36.77-.32.29-.43.30Z" fill="${palette.top}"/>
    <path d="M-1.45.74-1.56.81-1.29.81-1.11.79Z" fill="${palette.base}"/>
    <path d="M-2.005.12-1.98.25-1.83.40-1.69.37-1.72.24-1.87.15Z" fill="#ff5b59"/><path d="M-1.985.15-1.83.25-1.73.29" stroke="#ffb0a0" stroke-width=".025"/>
    <path d="M1.48.325 1.68.26 1.85.15 1.99-.025 1.78.065 1.62.22Z" fill="#8999a4"/><path d="M1.51.305 1.68.25 1.83.135 1.95.015 1.79.09 1.64.235Z" fill="#e9faff"/>
    <path d="M1.97-.22 2.04-.24 2.02-.35 1.92-.35Z M-2.02-.20-1.96-.21-1.96-.33-2.03-.33Z" fill="#1b2832"/>
    <circle cx="1.96" cy="-.30" r=".045" fill="#c5d9df"/>
    <path d="M-1.36.30-1.03.25-.78.11-.63-.29 M-.37.29-.38-.33 M.85.27 .72.10 .64-.21 .59-.33-.61-.33" stroke="#65717a" stroke-width=".012"/>
    <path d="M-.57-.02 .56-.02" stroke="${palette.shade}" stroke-width=".065" stroke-linecap="round"/><path d="M-.57 0 .56 0" stroke="${palette.top}" stroke-width=".035" stroke-linecap="round"/>
    <ellipse cx="-.91" cy=".23" rx=".082" ry=".027" fill="${palette.shade}"/><ellipse cx="-.91" cy=".245" rx=".078" ry=".021" fill="${palette.top}"/><ellipse cx=".12" cy=".21" rx=".082" ry=".027" fill="${palette.shade}"/><ellipse cx=".12" cy=".225" rx=".078" ry=".021" fill="${palette.top}"/>
    <path d="M.66.36 .82.31 .83.22 .64.24Z" fill="#24313d"/><path d="M.66.36 .79.32 .79.30 .66.31Z" fill="${palette.top}"/>
    <path d="M-1.08.82-1.0 1.10" stroke="#24313d" stroke-width=".014"/>` : vehicle === 'roadster' ? `
    <path d="M-2.04-.43V.12l.19.14.90.12.52.16.87.02.66-.23.43-.02.51-.34-.01-.38h-.11a.65.65 0 1 1-1.29 0H-.63a.65.65 0 1 1-1.29 0Z" fill="${palette.base}" stroke="${palette.top}" stroke-width=".018"/>
    <path d="M-1.08.38l.67.12.84.02.57-.18-.76-.05Z" fill="#101c26"/><path d="m-.44.51.05.01.17-.22-.05 0Z" fill="${palette.top}"/>
    <path d="m-.59.31 1.18-.10-.04-.56-1.14.04Z" fill="${palette.pale}" stroke="#65717a" stroke-width=".014"/><path d="M-.58-.4H.58" stroke="#1b2832" stroke-width=".07"/>
    <path d="m-2.04.12.19.06" stroke="#ff6c66" stroke-width=".055"/><path d="m1.84.03.20-.10" stroke="#d3faff" stroke-width=".035"/>` : `
    <path d="${vehicle === 'samandster' ? 'M-2.04-.43V.25L-1.45.31-.83.81-.61.84.41.83.99.34 1.87.19 2.04.04V-.43' : 'M-2.04-.43V.06L-1.90.39-1.33.81-1.07.84-.20.81.31.68 1.04.25 1.74.07 1.98-.12 2.04-.43'}H1.916a.65.65 0 1 1-1.282 0H-.634a.65.65 0 1 1-1.282 0Z" fill="${palette.base}" stroke="${palette.top}" stroke-width=".018"/>
    <path d="M-.63.19 .62.12 .60-.34-.63-.30Z" fill="${palette.pale}"/><path d="M-.63-.33 .62-.37 .62-.43-.63-.43Z" fill="${palette.shade}"/>
    ${vehicle === 'samandster' ? `<path d="M-1.26.32-.77.76-.17.76-.15.29Z M-.09.76 .38.75 .88.32-.05.29Z" fill="#101c26"/><path d="M-1.15.37-.74.72-.22.72-.23.62-.76.64Z M.01.72 .35.71 .75.37 .42.55 .01.59Z" fill="#354851"/><path d="M-2.02.20-1.94.18-1.96.07-2.03.08Z" fill="#ff6c66"/><path d="M1.65.14 1.96.06 2.0-.06 1.65-.02Z" fill="#e9faff"/><path d="M1.65.14 1.74.12 1.74-.03 1.65-.02Z" fill="#ffab52"/>` : `<path d="M-1.75.41-1.29.76-.40.73-.38.25Z M-.30.73 .22.62 .88.25-.31.26Z" fill="#101c26"/><path d="M-1.63.43-1.25.71-.45.69-.46.58-1.24.64Z M-.23.68 .20.57 .69.30 .15.47-.23.54Z" fill="#354851"/><path d="M-1.98.24-1.87.43-1.63.37-1.72.24Z" fill="#ff6c66"/><path d="M1.44.17 1.84.01 1.94-.16 1.74-.10Z" fill="#e9faff"/><path d="M-1.51.81-1.20.89-1.10.84Z" fill="${palette.top}"/>`}
    <path d="M-.17.24-.20-.30 M-.97.28-1.01.08 M.84.25 .65-.30" stroke="#65717a" stroke-width=".012"/>
    <path d="M-.94.14h.15 M.05.10h.14" stroke="#1b2832" stroke-width=".055" stroke-linecap="round"/>
    <path d="M-.63-.10 .61-.15 M-2.04-.04h.22 M1.88-.21h.16" stroke="#1b2832" stroke-width=".065" stroke-linecap="round"/>
    <path d="M.66.32 .85.28 .86.18 .69.21Z" fill="#24313d"/>`;
  const wheel = (x: number): string => `<g transform="translate(${x} -.36)"><circle r=".43" fill="#14202a"/><circle r=".345" fill="#45535d" stroke="#76838b" stroke-width=".025"/>${Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return `<path d="M ${Math.cos(angle)*.1} ${Math.sin(angle)*.1} L ${Math.cos(angle+.12)*.31} ${Math.sin(angle+.12)*.31}" stroke="#a2adb2" stroke-width=".065"/>`;
  }).join('')}<circle r=".09" fill="#263742" stroke="#98a4a9" stroke-width=".02"/></g>`;
  return `<svg viewBox="0 0 600 250" fill="none" aria-hidden="true" data-vehicle="${vehicle}"><defs><linearGradient id="garage-steel" x2="0" y2="1"><stop stop-color="#8c999f"/><stop offset="1" stop-color="#45515b"/></linearGradient></defs><ellipse cx="300" cy="224" rx="240" ry="10" fill="#050d1780"/><path d="M40 223h520" stroke="#73d8d870"/>
  <g transform="translate(300 140) scale(100 -100)">${wheel(-1.275)}${wheel(1.275)}
    ${body}
    ${ARMOR_PARTS.map((part, index) => index < carUpgradeLevel(armorLevel) ? `<g data-armor-part="${index}" transform="translate(0 ${index === 2 ? carModel(vehicle).roofLift : 0})"><polygon points="${part.points.map(point => point.join(',')).join(' ')}" fill="url(#garage-steel)" stroke="#b0bec3" stroke-width=".027"/>${part.bolts.map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".022" fill="#24303a" stroke="#b7c5cb" stroke-width=".009"/>`).join('')}</g>` : '').join('')}
  </g></svg>`;
}
