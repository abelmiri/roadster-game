import * as THREE from 'three';
import { AIR_JET_X, AIR_JET_Y } from './airJets';
import { CAR_ARCH_RADIUS, CAR_AXLE_Y, CAR_WHEEL_OFFSET } from './vehicle';
import { createRoadsterBody } from './roadsterModel';
import type { CarModelId } from './carModels';

type Point = [number, number];

/** The shells use the same tire openings and underbody equipment, so
 * changing the body keeps suspension, armor and jet exhaust in alignment. */
export function createVehicleBody(id: CarModelId): THREE.Group {
  if (id === 'roadster') return createRoadsterBody();
  const hatch = id === 'tibaster';
  const peugeot = id === 'peugester';
  const group = new THREE.Group();
  group.name = `${id}-body`;
  group.userData.carModel = id;
  group.userData.roofHeight = .84;
  const paint = new THREE.MeshLambertMaterial({ color: '#f3f4ee', flatShading: true });
  const top = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const pale = new THREE.MeshLambertMaterial({ color: '#d3d8d9', flatShading: true });
  const shade = new THREE.MeshLambertMaterial({ color: '#b3bdc5', flatShading: true });
  paint.name = 'paint-base'; top.name = 'paint-top'; pale.name = 'paint-pale'; shade.name = 'paint-shade';
  const glass = new THREE.MeshBasicMaterial({ color: '#101c26' });
  const reflection = new THREE.MeshBasicMaterial({ color: '#354851' });
  const trim = new THREE.MeshLambertMaterial({ color: '#1b2832', flatShading: true });
  const seam = new THREE.LineBasicMaterial({ color: '#65717a' });
  const headlight = new THREE.MeshBasicMaterial({ color: '#e9faff' });
  const amber = new THREE.MeshBasicMaterial({ color: '#ff9d3d' });
  const red = new THREE.MeshBasicMaterial({ color: '#ff5b59' });

  // The sedan retains a flat trunk and long hood. The hatch has an upright
  // tail, longer cabin and a short rounded nose, as in the supplied references.
  const outline: Point[] = peugeot
    ? [[-2.04, -.43], [-2.04, -.15], [-2.00, .15], [-1.86, .37], [-1.63, .58],
      [-1.30, .75], [-.92, .83], [-.55, .84], [-.14, .80], [.23, .68], [.68, .46],
      [1.14, .35], [1.58, .32], [1.86, .17], [2.01, -.04], [2.04, -.32], [2.02, -.43]]
    : hatch
    ? [[-2.04, -.43], [-2.04, -.05], [-1.96, .25], [-1.65, .52], [-1.12, .82],
      [-.76, .84], [.04, .80], [.50, .63], [.98, .27], [1.55, .16], [1.92, -.04], [2.04, -.25], [2.02, -.43]]
    : [[-2.04, -.43], [-2.04, .19], [-1.49, .24], [-.99, .78], [-.77, .84],
      [.28, .82], [.51, .76], [1.02, .29], [1.72, .20], [2.04, .08], [2.03, -.43]];
  group.userData.upperProfile = outline.slice(1);
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const archAngle = Math.asin((-.43 - CAR_AXLE_Y) / CAR_ARCH_RADIUS);
  for (const axle of [CAR_WHEEL_OFFSET, -CAR_WHEEL_OFFSET]) {
    shape.lineTo(axle + Math.cos(archAngle) * CAR_ARCH_RADIUS, -.43);
    shape.absarc(axle, CAR_AXLE_Y, CAR_ARCH_RADIUS, archAngle, Math.PI - archAngle, false);
  }
  shape.closePath();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth: 1.02, bevelEnabled: false, curveSegments: 12,
  }), [paint, pale]);
  body.name = `${id}-shell`;
  body.position.z = -.51;
  group.add(body);

  const panel = (points: Point[], material: THREE.Material, z = .516): THREE.Mesh => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    mesh.position.z = z;
    group.add(mesh);
    return mesh;
  };
  const line = (points: Point[], z = .533): void => {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      points.map(([x, y]) => new THREE.Vector3(x, y, z)),
    ), seam));
  };

  // Broad low-poly facets stay outside the fender cut-outs.
  panel([[-.61, .27], [.59, .22], [.57, -.34], [-.61, -.32]], pale);
  panel([[-.61, -.32], [.57, -.34], [.60, -.43], [-.61, -.43]], shade);
  if (peugeot) {
    // A rounded rear quarter, arched roof and long swept windshield give
    // this hatch its own silhouette rather than the Tibaster's upright cabin.
    panel([[-1.86, .37], [-1.61, .59], [-1.29, .76], [-.92, .83], [-1.02, .74], [-1.45, .58], [-1.70, .37]], top);
    panel([[-1.66, .40], [-1.48, .57], [-1.19, .70], [-.92, .75], [-.47, .75],
      [-.43, .30], [-1.37, .31], [-1.59, .34]], glass, .523);
    panel([[-1.49, .44], [-1.35, .57], [-1.12, .66], [-.93, .70], [-.53, .70],
      [-.52, .59], [-.98, .62], [-1.30, .53]], reflection, .524);
    panel([[-.35, .75], [-.15, .72], [.17, .62], [.57, .43], [.98, .35], [-.32, .29]], glass, .523);
    panel([[-.28, .69], [-.14, .67], [.15, .58], [.48, .43], [.71, .38], [-.29, .54]], reflection, .524);
    panel([[-.46, .77], [-.36, .77], [-.32, .29], [-.43, .30]], paint, .526);
    panel([[-1.29, .76], [-.92, .83], [-.55, .84], [-.14, .80], [.23, .68],
      [.17, .62], [-.15, .75], [-.55, .79], [-.94, .78]], top, .526);
    panel([[.23, .68], [.68, .46], [1.14, .35], [.98, .35], [.57, .43], [.17, .62]], paint, .527);
    panel([[1.14, .35], [1.58, .32], [1.86, .17], [1.80, .18], [1.54, .29]], top, .522);
    // The broad red tail and tapered almond-shaped headlight face opposite
    // ends: the source photo is mirrored into the game's forward direction.
    panel([[-2.005, .12], [-1.98, .25], [-1.83, .40], [-1.69, .37], [-1.72, .24], [-1.87, .15]], red, .529);
    panel([[-1.985, .15], [-1.83, .25], [-1.73, .29], [-1.75, .24], [-1.88, .18]], pale, .530);
    panel([[1.48, .325], [1.68, .26], [1.85, .15], [1.99, -.025],
      [1.78, .065], [1.62, .22]], trim, .527);
    panel([[1.51, .305], [1.68, .25], [1.83, .135], [1.95, .015],
      [1.79, .09], [1.64, .235]], headlight, .529);
    panel([[1.53, .30], [1.60, .28], [1.65, .235], [1.64, .235]], amber, .530);
    panel([[1.95, -.28], [2.035, -.30], [2.02, -.39], [1.95, -.38]], trim, .529);
    panel([[-2.04, -.23], [-1.96, -.24], [-1.96, -.34], [-2.04, -.34]], trim, .529);
    line([[-1.18, .30], [-.94, .26], [-.75, .12], [-.62, -.30]]);
    line([[-.38, .29], [-.37, -.34]]);
    line([[.98, .31], [.84, .16], [.72, .00], [.64, -.19], [.61, -.31], [.56, -.35], [-.60, -.33]]);
    // Raised body-color molding and oval recessed handles replace the dark
    // rubbing strips and angular handles on the other two sedans/hatches.
    panel([[-.61, .025], [.62, -.005], [.62, -.075], [-.61, -.045]], shade, .529);
    panel([[-.60, .025], [.61, -.005], [.60, -.045], [-.60, -.015]], paint, .530);
    for (const [x, y] of [[-.87, .265], [.04, .19]]) {
      const recess = new THREE.Shape(); recess.absellipse(0, 0, .095, .029, 0, Math.PI * 2, false, 0);
      const handle = new THREE.Mesh(new THREE.ShapeGeometry(recess, 10), shade);
      handle.position.set(x, y, .536); group.add(handle);
      panel([[x - .064, y + .008], [x + .064, y + .008], [x + .060, y - .008], [x - .060, y - .008]], paint, .537);
    }
    panel([[-1.45, .74], [-1.56, .81], [-1.29, .81], [-1.11, .79]], paint, .528);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.008, .017, .29, 6), trim);
    antenna.rotation.z = -.28; antenna.position.set(-1.04, .96, -.07); group.add(antenna);
    const fuelCap = new THREE.Mesh(new THREE.RingGeometry(.059, .066, 16), shade);
    fuelCap.position.set(-1.68, .23, .529); group.add(fuelCap);
  } else if (hatch) {
    panel([[-1.94, .25], [-1.64, .53], [-1.18, .79], [-1.30, .63], [-1.67, .36]], top);
    panel([[-1.56, .47], [-1.09, .75], [-.80, .77], [-.39, .74], [-.36, .29], [-1.48, .36]], glass, .523);
    panel([[-1.43, .48], [-1.06, .70], [-.81, .73], [-.44, .70], [-.44, .57], [-1.10, .66]], reflection, .524);
    panel([[-.28, .74], [.03, .72], [.43, .57], [.84, .28], [-.26, .30]], glass, .523);
    panel([[-.22, .69], [.00, .67], [.38, .54], [.60, .38], [-.23, .53]], reflection, .524);
    panel([[-.37, .77], [-.28, .76], [-.26, .29], [-.35, .29]], top, .526);
    panel([[-1.14, .82], [-.76, .84], [.04, .80], [.19, .75], [-.77, .79], [-1.20, .76]], top, .526);
    panel([[.43, .61], [.50, .63], [.98, .27], [.84, .28]], top, .527);
    panel([[-1.19, .82], [-1.35, .90], [-1.09, .89], [-.76, .84]], paint, .528);
    panel([[1.53, .14], [1.80, .06], [1.96, -.12], [1.74, -.08]], shade, .524);
    panel([[1.56, .12], [1.78, .045], [1.91, -.09], [1.76, -.04]], headlight, .528);
    panel([[-1.97, .22], [-1.85, .36], [-1.64, .42], [-1.69, .28], [-1.84, .22]], red, .529);
    panel([[-1.98, .17], [-1.84, .22], [-1.69, .28], [-1.72, .21], [-1.97, .12]], amber, .529);
    line([[-1.08, .35], [-.93, .29], [-.75, .12], [-.62, -.30]]);
    line([[-.32, .28], [-.34, -.35]]);
    line([[.87, .23], [.76, .12], [.68, -.05], [.62, -.28], [.58, -.34], [-.60, -.32]]);
    panel([[-.60, .04], [.62, -.025], [.60, -.10], [-.60, -.035]], trim, .529);
    panel([[-2.04, -.25], [-1.96, -.27], [-1.95, -.35], [-2.03, -.34]], trim, .528);
    panel([[1.96, -.31], [2.03, -.32], [2.02, -.43], [1.94, -.43]], trim, .529);
    const fuelCap = new THREE.Mesh(new THREE.RingGeometry(.061, .069, 16), shade);
    fuelCap.position.set(-1.72, .20, .529); group.add(fuelCap);
  } else {
    panel([[-1.47, .25], [-.99, .78], [-.77, .84], [-.91, .73], [-1.33, .27]], top);
    panel([[-1.20, .32], [-.86, .74], [-.11, .74], [-.09, .29]], glass, .523);
    panel([[-1.05, .39], [-.82, .69], [-.16, .69], [-.15, .57], [-.93, .58]], reflection, .524);
    panel([[.01, .74], [.28, .73], [.46, .68], [.88, .29], [.02, .29]], glass, .523);
    panel([[.07, .68], [.29, .67], [.42, .62], [.71, .36], [.08, .53]], reflection, .524);
    panel([[-.10, .77], [.00, .77], [.02, .28], [-.09, .28]], shade, .526);
    panel([[-.93, .79], [-.77, .84], [.28, .82], [.43, .77], [-.10, .79]], top, .526);
    panel([[.46, .68], [.51, .76], [1.02, .29], [.88, .29]], top, .527);
    panel([[-2.04, .17], [-1.49, .22], [-1.35, .27], [-1.52, .28], [-2.04, .21]], top, .522);
    panel([[1.04, .29], [1.72, .20], [2.04, .08], [2.02, .12], [1.71, .24]], top, .522);
    panel([[1.75, .13], [2.04, .075], [2.04, -.065], [1.77, -.04]], headlight, .528);
    panel([[1.75, .13], [1.82, .115], [1.83, -.047], [1.77, -.04]], amber, .529);
    line([[1.91, .095], [1.94, -.05]], .530);
    panel([[-2.045, .14], [-1.96, .13], [-1.92, -.015], [-2.045, .01]], red, .529);
    panel([[1.91, -.29], [1.98, -.29], [1.96, -.37], [1.91, -.37]], headlight, .529);
    panel([[-.61, -.07], [.61, -.10], [.60, -.18], [-.61, -.15]], trim, .529);
    panel([[-2.045, -.10], [-1.95, -.12], [-1.96, -.20], [-2.045, -.18]], trim, .529);
    panel([[1.94, -.12], [2.04, -.12], [2.04, -.20], [1.93, -.20]], trim, .529);
    panel([[1.10, .22], [1.20, .22], [1.20, .18], [1.10, .18]], amber, .529);
    line([[-1.21, .31], [-1.04, .30], [-.78, .18], [-.62, -.30]]);
    line([[-.055, .28], [-.055, -.34]]);
    line([[.92, .26], [.83, .17], [.72, .00], [.64, -.19], [.61, -.31], [.57, -.35], [-.60, -.33]]);
  }

  // Four-door handles and dark side mirrors distinguish both silhouettes
  // from the roadster's continuous sports canopy.
  for (const x of peugeot ? [] : hatch ? [-.94, .10] : [-.77, .17]) {
    const y = hatch && x < 0 ? .28 : .20;
    panel([[x, y], [x + .17, y - .01], [x + .16, y - .06], [x + .01, y - .05]], trim, .536);
  }
  panel([[.68, .37], [.78, .36], [.88, .26], [.66, .27], [.63, .31]], trim, .553);
  panel([[.66, .35], [.76, .34], [.80, .30], [.65, .31]], shade, .554);
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.16, .065, 1.055), trim);
  rocker.position.set(0, -.43, .004); group.add(rocker);
  addThrusters(group, trim, shade);
  group.position.z = 1.15;
  return group;
}

function addThrusters(group: THREE.Group, trim: THREE.Material, shade: THREE.Material): void {
  for (const z of [-.33, .38]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.075, .09, .17, 12), trim);
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(-2.055, -.25, z); group.add(nozzle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.072, .017, 5, 12), shade);
    rim.rotation.y = Math.PI / 2; rim.position.set(-2.145, -.25, z); group.add(rim);
  }
  for (const x of [-.46, .46]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.11, .075, .13, 12), trim);
    nozzle.position.set(x, -.49, .38); group.add(nozzle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.075, .017, 5, 12), shade);
    rim.rotation.x = Math.PI / 2; rim.position.set(x, -.555, .38); group.add(rim);
  }
  const glow = new THREE.MeshBasicMaterial({ color: '#a6f4ef' });
  for (const direction of [-1, 1]) {
    const jet = new THREE.Group();
    jet.name = direction > 0 ? 'front-air-nozzle' : 'rear-air-nozzle';
    jet.position.set(direction * AIR_JET_X, AIR_JET_Y, .56);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(.13, .095, .18, 12), trim);
    housing.position.y = .09;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.095, .025, 6, 12), shade);
    rim.rotation.x = Math.PI / 2;
    const outlet = new THREE.Mesh(new THREE.CircleGeometry(.072, 12), glow);
    outlet.rotation.x = Math.PI / 2; outlet.position.y = -.005;
    jet.add(housing, rim, outlet); group.add(jet);
  }
}
