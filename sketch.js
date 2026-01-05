let engine, world;
let ground, walls = [];
let keys = [];
let dragging = false;
let dragStart = null;
let dragEndX = 0, dragEndY = 0;
let previewParams = null;
const MIN_SIZE = 24;
const WALL_THICKNESS = 90;
let grabBody = null, grabConstraint = null;
let pointerX = 0, pointerY = 0;

// 자이로 및 권한 관련 변수
let gyroEnabled = false;
let permissionGranted = false;
let isCalibrated = false;

function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent("container");
  
  // 모바일 스크롤 및 튕김 방지
  cnv.elt.addEventListener('touchstart', e => e.preventDefault(), {passive: false});
  cnv.elt.addEventListener('touchmove', e => e.preventDefault(), {passive: false});

  engine = Matter.Engine.create();
  world = engine.world;
  buildBounds();
  rectMode(CENTER);
  angleMode(RADIANS);

  // iOS 13+ 이외의 환경(안드로이드 등)은 바로 권한 허용
  if (!(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')) {
    gyroEnabled = true;
    permissionGranted = true;
    isCalibrated = true;
  }
}

function draw() {
  background(245);

  // 기사 권장 사항: 권한 획득 전까지 UI로 가림
  if (!isCalibrated) {
    drawStartScreen();
    return; 
  }

  Matter.Engine.update(engine);

  if (gyroEnabled) {
    // 요청하신 예전 박스 예제 감도 (-90~90 -> -2~2)
    engine.gravity.x = map(rotationY, -90, 90, -2, 2);
    engine.gravity.y = map(rotationX, -90, 90, -2, 2);
    engine.gravity.x = constrain(engine.gravity.x, -8, 8);
    engine.gravity.y = constrain(engine.gravity.y, -8, 8);
  }

  if (grabConstraint) {
    grabConstraint.pointA.x = pointerX;
    grabConstraint.pointA.y = pointerY;
  }

  for (const k of keys) k.show();
  if (dragging && dragStart) drawPreview();
}

function drawStartScreen() {
  push();
  fill(0, 150);
  rect(width / 2, height / 2, width, height);
  fill(50, 150, 255);
  rect(width / 2, height / 2, 220, 70, 15);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(22);
  text("시작하기", width / 2, height / 2);
  textSize(14);
  text("터치하여 센서 권한을 허용하세요", width / 2, height / 2 + 60);
  pop();
}

function touchStarted() {
  // 사용자의 명시적인 터치 이벤트 안에서 handlePermission 호출
  if (!isCalibrated) {
    if (mouseX > width/2 - 110 && mouseX < width/2 + 110 && 
        mouseY > height/2 - 35 && mouseY < height/2 + 35) {
      handlePermission();
      return false;
    }
    return false;
  }

  if (permissionGranted) {
    let tx = (touches.length > 0) ? touches[0].x : mouseX;
    let ty = (touches.length > 0) ? touches[0].y : mouseY;
    startPointer(tx, ty);
  }
  return false;
}

function handlePermission() {
  // iOS 13+ 기기에서 권한 요청 (기사 권장 로직)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(res => {
        if (res === 'granted') { // 권한 승인 시
          gyroEnabled = true;
          permissionGranted = true;
          isCalibrated = true;
        }
      })
      .catch(err => {
        alert("권한 요청 실패: " + String(err)); // HTTPS가 아닐 때 주로 발생
      });
  } else {
    isCalibrated = true;
  }
}

// --- 물리 및 생성 로직 ---

function buildKeyBodyLocal(x, y, w, h, p, angle) {
  const bowX = -w * 0.3;
  const shaftW = w * 0.7;
  const shaftX = bowX + p.bowW * 0.6 + shaftW / 2;
  const head = Matter.Bodies.circle(bowX, 0, p.bowH / 2, { density: 0.002 });
  const shaft = Matter.Bodies.rectangle(shaftX, 0, shaftW, p.shaftHeight);
  const parts = [head, shaft];
  const tipRegionRatio = 0.35;
  const regionStart = shaftX + shaftW / 2 - shaftW * tipRegionRatio;
  const notchSpacing = (shaftW * tipRegionRatio) / (p.notchCount + 1);
  for (let i = 0; i < p.notchCount; i++) {
    const nx = regionStart + notchSpacing * (i + 1);
    const nd = p.notchDepths[i];
    const notchBody = Matter.Bodies.rectangle(nx, p.shaftHeight / 2 + nd / 2, notchSpacing * 0.7, nd);
    parts.push(notchBody);
  }
  const compound = Matter.Body.create({ parts, friction: 0.3, restitution: 0.2, frictionAir: 0.015 });
  Matter.Body.setPosition(compound, { x, y });
  Matter.Body.setAngle(compound, angle);
  return compound;
}

function drawKeyGraphic(cx, cy, boxW, boxH, p) {
  const { bowW, bowH, shaftHeight, notchCount, notchDepths, col } = p;
  push(); translate(cx, cy); rectMode(CENTER); noStroke();
  const bowX = -boxW * 0.3;
  const shaftW = boxW * 0.7;
  const shaftX = bowX + bowW * 0.6 + shaftW / 2;
  fill(col); ellipse(bowX, 0, bowW, bowH);
  fill(245); ellipse(bowX, 0, bowW * 0.5, bowH * 0.5);
  fill(col); rect(shaftX, 0, shaftW, shaftHeight);
  const tipRegionRatio = 0.35;
  const regionStart = shaftX + shaftW / 2 - shaftW * tipRegionRatio;
  const notchSpacing = (shaftW * tipRegionRatio) / (notchCount + 1);
  for (let i = 0; i < notchCount; i++) {
    rect(regionStart + notchSpacing * (i + 1), shaftHeight / 2 + notchDepths[i] / 2, notchSpacing * 0.7, notchDepths[i]);
  }
  pop();
}

function drawPreview() {
  const w = dragEndX - dragStart.x;
  const h = dragEndY - dragStart.y;
  const boxW = Math.abs(w), boxH = Math.abs(h);
  if (boxW < MIN_SIZE || boxH < MIN_SIZE) return;
  const centerX = dragStart.x + w / 2;
  const centerY = dragStart.y + h / 2;
  push(); noFill(); stroke(0, 80); strokeWeight(1);
  rect(centerX, centerY, boxW, boxH); pop();
  previewParams = generateKeyParams(boxW, boxH);
  push(); translate(centerX, centerY); rotate(0);
  drawKeyGraphic(0, 0, boxW, boxH, previewParams); pop();
}

class KeyObject {
  constructor(x, y, w, h, params, angle) {
    this.w = w; this.h = h; this.params = params;
    this.body = buildKeyBodyLocal(x, y, w, h, params, angle);
    Matter.World.add(world, this.body);
  }
  show() {
    push(); translate(this.body.position.x, this.body.position.y);
    rotate(this.body.angle); drawKeyGraphic(0, 0, this.w, this.h, this.params); pop();
  }
}

function startPointer(x, y) {
  pointerX = x; pointerY = y;
  if (tryGrabKey(x, y)) return;
  dragging = true; dragStart = createVector(x, y);
  dragEndX = x; dragEndY = y;
}
function movePointer(x, y) {
  pointerX = x; pointerY = y;
  if (dragging) { dragEndX = x; dragEndY = y; }
}
function endPointer() {
  releaseGrab();
  if (!dragging || !dragStart) return;
  let w = dragEndX - dragStart.x, h = dragEndY - dragStart.y;
  let boxW = Math.abs(w), boxH = Math.abs(h);
  if (boxW >= MIN_SIZE && boxH >= MIN_SIZE) {
    keys.push(new KeyObject(dragStart.x + w/2, dragStart.y + h/2, boxW, boxH, generateKeyParams(boxW, boxH), 0));
  }
  dragging = false; dragStart = null;
}

function generateKeyParams(boxW, boxH) {
  const overallH = boxH * 0.9;
  const shaftH = overallH * random(0.25, 0.35);
  return {
    bowW: Math.min(boxW * 0.5, (overallH * random(0.3, 0.45)) * random(0.85, 1.45)),
    bowH: overallH * random(0.3, 0.45),
    shaftHeight: shaftH,
    notchCount: floor(random(3, 7)),
    notchDepths: Array.from({length: 7}, () => random(shaftH * 0.35, shaftH * 1.05)),
    col: color(random(40, 255), random(40, 255), random(40, 255))
  };
}

function tryGrabKey(mx, my) {
  const found = Matter.Query.point(keys.map(k => k.body), { x: mx, y: my });
  if (found.length === 0) return false;
  grabBody = found[0];
  grabConstraint = Matter.Constraint.create({
    pointA: { x: mx, y: my }, bodyB: grabBody, pointB: Matter.Vector.sub({ x: mx, y: my }, grabBody.position),
    stiffness: 0.1, damping: 0.1
  });
  Matter.World.add(world, grabConstraint);
  return true;
}

function releaseGrab() { if (grabConstraint) { Matter.World.remove(world, grabConstraint); grabConstraint = null; } }

function buildBounds() {
  const t = WALL_THICKNESS;
  if (ground) Matter.World.remove(world, [ground, ...walls]);
  ground = Matter.Bodies.rectangle(width/2, height + t/2, width, t, { isStatic: true });
  walls = [
    Matter.Bodies.rectangle(-t/2, height/2, t, height, { isStatic: true }),
    Matter.Bodies.rectangle(width+t/2, height/2, t, height, { isStatic: true }),
    Matter.Bodies.rectangle(width/2, -t/2, width, t, { isStatic: true })
  ];
  Matter.World.add(world, [ground, ...walls]);
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); buildBounds(); }
function mousePressed() { if (touches.length === 0) startPointer(mouseX, mouseY); }
function mouseDragged() { if (touches.length === 0) movePointer(mouseX, mouseY); }
function mouseReleased() { if (touches.length === 0) endPointer(); }
function touchMoved() { if (touches.length > 0) movePointer(touches[0].x, touches[0].y); return false; }
function touchEnded() { endPointer(); return false; }