import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Mesh, Vector3, Raycaster } from 'three';
import RAPIER from '@dimforge/rapier2d-compat';

let CAR_MODELS, CAR_MODEL_PRICE, createVehicleBody, CarBodyDamage, CarArmorVisual, PlayerProgress, GamePhysics, carGarageIcon;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-vehicle-tests');
  const entries = ['carModels','vehicleModels','carBodyDamage','carArmor','playerProgress','physics','carGarageIcon'];
  await build({ entryPoints: entries.map(name => `src/game/${name}.ts`), bundle: true, platform: 'node', format: 'esm',
    outdir, outExtension: { '.js': '.mjs' }, external: ['three','@dimforge/rapier2d-compat'] });
  const modules = await Promise.all(entries.map(name => import(pathToFileURL(path.join(outdir, `${name}.mjs`)).href)));
  ({ CAR_MODELS, CAR_MODEL_PRICE, createVehicleBody, CarBodyDamage, CarArmorVisual, PlayerProgress, GamePhysics, carGarageIcon } = Object.assign({}, ...modules));
  await RAPIER.init();
});
function dispose(body) {
  const materials = new Set();
  body.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) materials.add(material);
  });
  materials.forEach(material => material.dispose());
}

test('four distinct shells retain open fenders, aligned jets, safe geometry and all paint facets', () => {
  assert.deepEqual(CAR_MODELS.map(model => model.id), ['roadster','samandster','tibaster','peugester']);
  const outlines = [];
  for (const model of CAR_MODELS) {
    const body = createVehicleBody(model.id);
    try {
      body.position.z = 0; body.updateMatrixWorld(true);
      const shell = body.children[0];
      outlines.push(Array.from(shell.geometry.attributes.position.array).join(','));
      const names = new Set();
      body.traverse(object => {
        if (object.geometry) assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite));
        if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) names.add(material.name);
      });
      for (const name of ['paint-base','paint-top','paint-pale','paint-shade']) assert.ok(names.has(name));
      for (const axle of [-1.275, 1.275]) {
        const ray = new Raycaster(new Vector3(axle, -.36, 3), new Vector3(0,0,-1));
        assert.equal(ray.intersectObject(shell).length, 0, `${model.id} filled its wheel opening`);
      }
      if (model.id === 'peugester') {
        const hood = new Raycaster(new Vector3(1.275, .32, 3), new Vector3(0,0,-1));
        assert.ok(hood.intersectObject(shell).length > 0, 'the sloping hood must clear the front fender opening');
      }
      assert.equal(body.getObjectByName('front-air-nozzle').position.x, 1.87);
      assert.equal(body.getObjectByName('rear-air-nozzle').position.x, -1.87);
      assert.ok(carGarageIcon(4,'red',model.id).includes(`data-vehicle="${model.id}"`));
    } finally { dispose(body); }
  }
  assert.equal(new Set(outlines).size, 4, 'model choices must have distinct silhouettes');
});

test('new shells keep selected paint through each damage stage and full repair', () => {
  for (const model of CAR_MODELS) {
    const body = createVehicleBody(model.id); const damage = new CarBodyDamage(body, model.roofLift);
    try {
      damage.setPaint('blue'); damage.update(100);
      const material = body.children[0].material[0];
      const blue = material.color.getHexString();
      for (const health of [75,50,25,0]) { damage.update(health); assert.notEqual(material.color.getHexString(), blue); }
      damage.update(100); assert.equal(material.color.getHexString(), blue);
      damage.setPaint('pink'); damage.update(100); assert.notEqual(material.color.getHexString(), blue);
    } finally { damage.dispose(); dispose(body); }
  }
});

test('vehicle purchases cost 100 once and save independent paints while sharing all three upgrades', () => {
  const upgrades={armor:2,'boost-reserve':1,'boost-power':3};
  const values = new Map([['roadster-progress', JSON.stringify({ version:1,coins:500,carUpgrades:upgrades,ownedPaints:['blue','pink'],selectedPaint:'blue' })]]);
  const storage = { getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value) };
  let player = new PlayerProgress(storage);
  assert.equal(CAR_MODEL_PRICE,100);
  assert.equal(player.selectedVehicle, 'roadster');
  assert.equal(player.ownsVehicle('roadster'),true); assert.equal(player.selectedPaint,'blue');
  const colors={roadster:'blue',samandster:'pink',tibaster:'white',peugester:'blue'};
  let balance=500;
  for (const model of CAR_MODELS.slice(1)) {
    assert.equal(player.ownsVehicle(model.id),false);
    assert.equal(player.selectVehicle(model.id),false,'a locked car must not be equipped');
    assert.equal(player.paintForVehicle(model.id),'white','another car must not inherit the legacy Roadster color');
    assert.equal(player.purchaseVehicle(model.id),'purchased'); balance-=100;
    assert.equal(player.selectedVehicle,model.id); assert.equal(player.selectedPaint,'white');
    assert.equal(player.selectPaint(colors[model.id]),true);
    assert.equal(player.purchaseVehicle(model.id),'owned');
    player = new PlayerProgress(storage);
    assert.equal(player.selectedVehicle,model.id); assert.equal(player.coins,balance);
    assert.equal(player.selectedPaint,colors[model.id]); assert.deepEqual(player.carUpgrades,upgrades);
  }
  for (const model of CAR_MODELS) {
    assert.equal(player.selectVehicle(model.id), true);
    player = new PlayerProgress(storage);
    assert.equal(player.selectedVehicle, model.id); assert.equal(player.coins,200);
    assert.equal(player.selectedPaint,colors[model.id]); assert.deepEqual(player.carUpgrades,upgrades);
  }
  const saved=JSON.parse(values.get('roadster-progress'));
  assert.deepEqual(saved.vehiclePaints,colors);
  assert.deepEqual(new Set(saved.ownedVehicles),new Set(CAR_MODELS.map(model=>model.id)));
  assert.equal(player.selectVehicle('unknown'),false);
  assert.equal(player.purchaseVehicle('unknown'),'unknown'); assert.equal(player.coins,200);
  values.set('roadster-progress',JSON.stringify({version:1,ownedVehicles:['roadster'],coins:99}));
  player=new PlayerProgress(storage);
  assert.equal(player.purchaseVehicle('samandster'),'insufficient-coins');
  assert.equal(player.ownsVehicle('samandster'),false); assert.equal(player.selectedVehicle,'roadster');
  assert.equal(player.coins,99);
});

test('legacy migration preserves only the selected car and its paint while explicit ownership and palette validation remain authoritative', () => {
  const values=new Map(); const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  values.set('roadster-progress',JSON.stringify({version:1,coins:500,selectedVehicle:'tibaster',ownedPaints:['blue'],selectedPaint:'blue'}));
  let player=new PlayerProgress(storage);
  assert.equal(player.selectedVehicle,'tibaster'); assert.equal(player.selectedPaint,'blue');
  assert.equal(player.ownsVehicle('roadster'),true); assert.equal(player.ownsVehicle('tibaster'),true);
  assert.equal(player.ownsVehicle('samandster'),false); assert.equal(player.ownsVehicle('peugester'),false);
  for(const id of ['roadster','samandster','peugester']) assert.equal(player.paintForVehicle(id),'white');
  player.selectVehicle('roadster'); assert.equal(player.selectedPaint,'white');
  player=new PlayerProgress(storage); player.selectVehicle('tibaster'); assert.equal(player.selectedPaint,'blue');
  values.set('roadster-progress',JSON.stringify({version:1,coins:500,ownedVehicles:['samandster','unknown'],selectedVehicle:'tibaster',
    ownedPaints:['blue','pink'],vehiclePaints:{roadster:'pink',samandster:'blue',tibaster:'invalid',peugester:'red'}}));
  player=new PlayerProgress(storage);
  assert.equal(player.selectedVehicle,'roadster'); assert.equal(player.selectedPaint,'pink');
  assert.equal(player.ownsVehicle('samandster'),true); assert.equal(player.ownsVehicle('tibaster'),false);
  assert.equal(player.ownsVehicle('peugester'),false); assert.equal(player.ownsVehicle('unknown'),false);
  assert.equal(player.paintForVehicle('tibaster'),'white'); assert.equal(player.paintForVehicle('peugester'),'white');
  player.selectVehicle('samandster'); assert.equal(player.selectedPaint,'blue');
  values.set('roadster-progress',JSON.stringify({version:1,selectedVehicle:'unknown',ownedPaints:['blue'],selectedPaint:'blue',coins:500}));
  assert.equal(new PlayerProgress(storage).selectedVehicle,'roadster');
  assert.equal(new PlayerProgress(storage).selectedPaint,'blue');
});

test('tall roofs lift actual projectile origins while model switching preserves ammo and car state', () => {
  const idle = { jumpPressed:false,jumpHeld:false,suction:false,boost:false };
  for (const model of CAR_MODELS) {
    const game = new GamePhysics(7, {id:'machine-gun',xp:0,vehicle:model.id});
    try {
      assert.equal(game.weapon.mountLift, model.roofLift);
      const pose = {x:0,y:10,angle:.4,vx:0,vy:0};
      game.weapon.step(0,{fire:true},pose,[],()=>{});
      const projectile = game.weapon.snapshot().projectiles[0];
      const height = .55 + .30 + model.roofLift;
      assert.ok(Math.abs(projectile.y-(pose.y-.16*Math.sin(.4)+height*Math.cos(.4)+1.5*Math.sin(.4)))<1e-8);
      const ammo = game.weapon.ammoFor('machine-gun'); const health = game.snapshot(1).health;
      game.selectVehicle('peugester'); game.selectVehicle('roadster');
      assert.equal(game.weapon.ammoFor('machine-gun'),ammo); assert.equal(game.snapshot(1).health,health);
      game.step(idle);
    } finally { game.dispose(); }
  }
});

test('raised roof armor detaches from its visible mount and leaves other plate positions unchanged', () => {
  const armor = new CarArmorVisual();
  try {
    armor.setRoofLift(.29);
    const state = {car:{x:10,y:4,angle:0},armorMask:15,wrecked:false,distance:10,impactSerial:0,speed:14,suspensionOffset:0,suspensionPitch:0};
    armor.update(state,0);
    assert.equal(armor.attached.children[2].position.y,.69+.29);
    const positions = armor.attached.children.map(part => part.position.clone());
    armor.update({...state,armorMask:11,impactSerial:1},0);
    assert.ok(Math.abs(armor.debris.children[2].position.y-(4+positions[2].y))<1e-8);
    armor.setRoofLift(0);
    assert.equal(armor.attached.children[2].position.y,.69);
    for (const index of [0,1,3]) assert.ok(armor.attached.children[index].position.equals(positions[index]));
  } finally { armor.dispose(); }
});
