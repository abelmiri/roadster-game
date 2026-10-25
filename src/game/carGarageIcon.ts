import { ARMOR_PARTS } from './armorParts';
import { carUpgradeLevel } from './carUpgrades';

/** Code-native preview shares the armor silhouettes with the in-game meshes. */
export function carGarageIcon(armorLevel: number): string {
  const wheel = (x: number): string => `<g transform="translate(${x} -.36)"><circle r=".43" fill="#14202a"/><circle r=".345" fill="#45535d" stroke="#76838b" stroke-width=".025"/>${Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return `<path d="M ${Math.cos(angle)*.1} ${Math.sin(angle)*.1} L ${Math.cos(angle+.12)*.31} ${Math.sin(angle+.12)*.31}" stroke="#a2adb2" stroke-width=".065"/>`;
  }).join('')}<circle r=".09" fill="#263742" stroke="#98a4a9" stroke-width=".02"/></g>`;
  return `<svg viewBox="0 0 600 250" fill="none" aria-hidden="true"><defs><linearGradient id="garage-steel" x2="0" y2="1"><stop stop-color="#8c999f"/><stop offset="1" stop-color="#45515b"/></linearGradient></defs><ellipse cx="300" cy="224" rx="240" ry="10" fill="#050d1780"/><path d="M40 223h520" stroke="#73d8d870"/>
  <g transform="translate(300 140) scale(100 -100)">${wheel(-1.275)}${wheel(1.275)}
    <path d="M-2.04-.43V.12l.19.14.90.12.52.16.87.02.66-.23.43-.02.51-.34-.01-.38h-.11a.65.65 0 0 1-1.29 0H-.63a.65.65 0 0 1-1.29 0Z" fill="#f3f4ee" stroke="#bbc8d0" stroke-width=".018"/>
    <path d="M-1.08.38l.67.12.84.02.57-.18-.76-.05Z" fill="#101c26"/><path d="m-.44.51.05.01.17-.22-.05 0Z" fill="#e8ece9"/>
    <path d="m-.59.31 1.18-.10-.04-.56-1.14.04Z" fill="#d3d8d9" stroke="#65717a" stroke-width=".014"/><path d="M-.58-.4H.58" stroke="#1b2832" stroke-width=".07"/>
    <path d="m-2.04.12.19.06" stroke="#ff6c66" stroke-width=".055"/><path d="m1.84.03.20-.10" stroke="#d3faff" stroke-width=".035"/>
    ${ARMOR_PARTS.map((part, index) => index < carUpgradeLevel(armorLevel) ? `<g data-armor-part="${index}"><polygon points="${part.points.map(point => point.join(',')).join(' ')}" fill="url(#garage-steel)" stroke="#b0bec3" stroke-width=".027"/>${part.bolts.map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".022" fill="#24303a" stroke="#b7c5cb" stroke-width=".009"/>`).join('')}</g>` : '').join('')}
  </g></svg>`;
}
