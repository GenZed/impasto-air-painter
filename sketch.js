let video;
let handLandmarker;
let lastVideoTime = -1;
let x = 250, y = 200;
let targetX = 250, targetY = 200; // latest fingertip from the camera, x/y glide towards it
let prevX = null, prevY = null;
let brushSize = 0.9;  // [ and ] to change
let load = 1;         // paint left on the brush, 1 = freshly loaded
let speedWeight = 1;  // smoothed width change from hand speed
let travel = 0;       // px moved since the last dab, carried across frames
let gesture = "none";
let cursorDot; // html element, so the cursor doesn't paint over the canvas

// panel - pick a dab shape, colour and size by holding the fingertip over a control
let shape = "circle";
let paintColour = null; // {h, s, b} from the picker, null = each gesture's own hue range
let pickerPos = null;   // where the picked colour sits on the picker, [0-1, 0-1]
let tools = [];         // panel controls, for hit-testing the fingertip
let panel, pickerMark, sizeFill, sizeHover;
let hovered = null, hoverStart = 0, dwellDone = false;
let anchorX = 0, anchorY = 0; // where the current hold started
const DWELL_MS = 2000;
const STILL_PX = 14;    // the picker and slider only count a hold while the fingertip stays this still
const SHAPES = ["circle", "triangle", "square"];
const SIZE_MIN = 0.4, SIZE_MAX = 3;

// MediaPipe Hand Landmarker - 21 keypoints per hand, 8 = index fingertip
const TASKS_VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_BASE = 5;
const MIDDLE_BASE = 9;
const INDEX_TIP = 8;

// [tip, middle joint] for index, middle, ring, pinky
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];

// impasto paint (see impasto.js): each stroke is a trail of closely spaced dabs,
// turned to face along the stroke so their bristle grooves join up into ridges
const BRUSH_RADIUS = 17.5;  // px at brushSize 1
const DAB_SPACING = 0.18;   // gap between dabs, as a fraction of the radius
const MIN_STEP = 6;         // px the brush must move before laying down paint - stops blobs when still
const LOAD_LENGTH = 1500;   // px of stroke before the brush runs dry

// each gesture picks a brush, and each brush swings between two hues
const BRUSHES = {
  point: [0, 55],     // index finger - reds to yellows
  peace: [180, 280],  // index + middle - cyan, blue, violet
  three: [80, 160]    // thumb + index + middle - greens
};

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  // dabs are flat shapes at the same depth - without this they z-fight instead of layering
  drawingContext.disable(drawingContext.DEPTH_TEST);

  colorMode(HSB);
  angleMode(DEGREES);
  noStroke();

  // no background - the canvas stays transparent so the camera shows through
  setupImpasto();

  // live camera behind the canvas, mirrored and filling the window
  video = createCapture(VIDEO);
  video.class("camera");

  cursorDot = createDiv();
  cursorDot.class("cursor");

  buildPanel();

  loadHandModel();

}

async function loadHandModel() {
  // tasks-vision is an ES module, so load it with a dynamic import
  const { FilesetResolver, HandLandmarker } = await import(TASKS_VISION + "/vision_bundle.mjs");
  const vision = await FilesetResolver.forVisionTasks(TASKS_VISION + "/wasm");

  const options = {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1
  };

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  } catch (err) {
    // fall back to CPU if WebGL/GPU isn't available
    options.baseOptions.delegate = "CPU";
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  }
  console.log("model ready");
}

function detectHands() {
  // only run when the model is loaded and there's a new video frame
  if (!handLandmarker || video.elt.readyState < 2) return;
  if (video.elt.currentTime === lastVideoTime) return;
  lastVideoTime = video.elt.currentTime;

  let results = handLandmarker.detectForVideo(video.elt, performance.now());
  if (results.landmarks.length > 0) {
    let hand = results.landmarks[0];
    let tip = toScreen(hand[INDEX_TIP]);
    gesture = readGesture(hand);
    targetX = tip.x;
    targetY = tip.y;
  } else {
    gesture = "none";
  }

}

// landmarks are normalised 0-1 over the camera frame, but the video is
// scaled to cover the window (cropping the edges) and mirrored
function toScreen(point) {
  let vw = video.elt.videoWidth, vh = video.elt.videoHeight;
  let s = max(width / vw, height / vh);
  return {
    x: (1 - point.x) * vw * s - (vw * s - width) / 2,
    y: point.y * vh * s - (vh * s - height) / 2
  };
}

// distance between landmarks in camera pixels, so x and y are on the same scale
function gap(a, b) {
  return dist(a.x * video.elt.videoWidth, a.y * video.elt.videoHeight,
              b.x * video.elt.videoWidth, b.y * video.elt.videoHeight);
}

// a finger is up when its tip is further from the wrist than its middle joint
function fingersUp(hand) {
  let wrist = hand[WRIST];
  let fingers = FINGERS.map(([tip, joint]) =>
    gap(hand[tip], wrist) > gap(hand[joint], wrist) * 1.1
  );
  // the thumb is up when its tip sticks out away from the index knuckle
  let palm = gap(hand[WRIST], hand[MIDDLE_BASE]);
  let thumb = gap(hand[THUMB_TIP], hand[INDEX_BASE]) > palm * 0.5;
  return [thumb, ...fingers];
}

function readGesture(hand) {
  let [thumb, index, middle, ring, pinky] = fingersUp(hand);
  if (ring || pinky || !index) return "none";
  if (middle) return thumb ? "three" : "peace";
  return "point";
}

function buildPanel() {
  panel = createDiv().id("panel");

  let shapes = createDiv().class("group shapes").parent(panel);
  for (let s of SHAPES) {
    let el = addTool("shape", shapes, () => shape = s);
    createDiv().class("icon " + s).parent(el);
    if (s === shape) el.addClass("selected");
  }

  // the original per-gesture colours
  let auto = addTool("colour", shapes, () => {
    paintColour = null;
    pickerPos = null;
  });
  auto.addClass("swatch auto selected");

  // colour picker - hue across, light at the top, full colour in the middle, dark at the bottom
  let picker = addTool("colour", panel, (fx, fy) => {
    paintColour = pickerColour(fx, fy);
    pickerPos = [fx, fy];
  }, (pos) => showPickerMark(pos || pickerPos));
  picker.addClass("picker");
  pickerMark = createDiv().class("mark").parent(picker);
  showPickerMark(null);

  // brush size - a wedge that grows to the right
  let slider = addTool("size", panel, (fx) => {
    brushSize = lerp(SIZE_MIN, SIZE_MAX, fx);
  }, (pos) => showSizeHover(pos));
  slider.addClass("slider");
  let track = createDiv().class("track").parent(slider);
  sizeFill = createDiv().class("fill").parent(track);
  sizeHover = createDiv().class("hover").parent(slider);
  showSizeHover(null);
  updateSizeFill();
}

// `onHover` marks a continuous control (picker, slider): it gets the fingertip's
// position on the control as [0-1, 0-1] while hovered, and null when the fingertip leaves
function addTool(group, parent, onSelect, onHover) {
  let el = createDiv().class("tool").parent(parent);
  tools.push({ el, group, onSelect, onHover });
  return el;
}

function selectTool(tool, pos) {
  for (let t of tools) {
    if (t.group === tool.group) t.el.removeClass("selected");
  }
  tool.el.addClass("selected");
  tool.onSelect(...pos);
  showPickerMark(pickerPos);
  updateSizeFill();
}

function inside(el, px, py) {
  let r = el.elt.getBoundingClientRect();
  return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
}

// fingertip position across an element, 0-1 each way
function posOn(el, px, py) {
  let r = el.elt.getBoundingClientRect();
  return [constrain((px - r.left) / r.width, 0, 1),
          constrain((py - r.top) / r.height, 0, 1)];
}

function pickerColour(fx, fy) {
  let h = fx * 360;
  if (fy < 0.5) return { h, s: lerp(5, 95, fy * 2), b: lerp(100, 90, fy * 2) };
  return { h, s: 95, b: lerp(90, 15, (fy - 0.5) * 2) };
}

function showPickerMark(pos) {
  if (!pos) return pickerMark.hide();
  let c = pickerColour(...pos);
  pickerMark.show();
  pickerMark.style("left", pos[0] * 100 + "%");
  pickerMark.style("top", pos[1] * 100 + "%");
  pickerMark.style("background", color(c.h, c.s, c.b).toString());
}

function showSizeHover(pos) {
  if (!pos) return sizeHover.hide();
  sizeHover.show();
  sizeHover.style("left", pos[0] * 100 + "%");
}

function updateSizeFill() {
  sizeFill.style("width", (brushSize - SIZE_MIN) / (SIZE_MAX - SIZE_MIN) * 100 + "%");
}

function setDwell(tool, progress) {
  tool.el.elt.style.setProperty("--dwell", progress);
}

// hold the fingertip on a control for DWELL_MS to select it; it fills up while you wait.
// On the picker and slider the hold restarts whenever the fingertip drifts, so it picks
// the spot you settle on. Returns true when the fingertip is over the panel, so it doesn't paint
function updatePanel(handUp) {
  let over = handUp ? tools.find(t => inside(t.el, x, y)) : undefined;
  let drifted = over && over.onHover && dist(x, y, anchorX, anchorY) > STILL_PX;

  if (over !== hovered || drifted) {
    if (hovered) setDwell(hovered, 0);
    if (hovered && hovered !== over && hovered.onHover) hovered.onHover(null);
    hovered = over;
    hoverStart = millis();
    dwellDone = false;
    anchorX = x;
    anchorY = y;
  }

  if (hovered) {
    let pos = posOn(hovered.el, x, y);
    if (hovered.onHover) hovered.onHover(pos);

    if (!dwellDone) {
      let progress = min(1, (millis() - hoverStart) / DWELL_MS);
      setDwell(hovered, progress);
      if (progress === 1) {
        selectTool(hovered, pos);
        dwellDone = true; // move (or drift) to select again
        setDwell(hovered, 0);
      }
    }
  }

  return handUp && inside(panel, x, y);
}

// impasto stroke - dabs spaced along the path, facing along it; the light and shadow
// come from the paint's relief in impasto.js. Hue swings between hueA and hueB
function paintStroke(x1, y1, x2, y2, [hueA, hueB], sat = 95, bri = 90) {
  let hue = (map(sin(frameCount * 2), -1, 1, hueA, hueB) + 360) % 360;
  let len = dist(x1, y1, x2, y2);

  // fast strokes thin out, slow ones press down; smoothed so the width doesn't flicker
  speedWeight = lerp(speedWeight, map(len, 0, 40, 1.15, 0.6, true), 0.15);

  // the brush runs dry over a long stroke - narrower and flatter paint
  load = max(0, load - len / LOAD_LENGTH);
  let r = BRUSH_RADIUS * brushSize * speedWeight * lerp(0.8, 1, load);
  let thickness = lerp(0.45, 1, load);
  let angle = atan2(y2 - y1, x2 - x1);
  let colour = color(hue, sat, bri);

  // walk along the segment, dropping a dab every `step` px
  let step = r * DAB_SPACING;
  travel += len;
  while (travel >= step) {
    travel -= step;
    let t = 1 - travel / len;
    addDab(lerp(x1, x2, t), lerp(y1, y2, t), r, angle, colour, thickness);
  }
}

function draw() {
  detectHands();

  //lerping - linear interpolation for smoother transitions
  /*lerp takes 3 arguments, val1, val2, percentage and interpolates between val1 and val2 according to the percentage point value*/
  // done every frame (not just on new camera frames) so the brush glides instead of stepping
  x = lerp(x, targetX, 0.25);
  y = lerp(y, targetY, 0.25);

  let hues = BRUSHES[gesture];
  // a picked colour overrides the gesture's colours, with a small hue swing either side
  let tone = [95, 90];
  if (hues && paintColour) {
    hues = [paintColour.h - 8, paintColour.h + 8];
    tone = [paintColour.s, paintColour.b];
  }
  let onPanel = updatePanel(!!hues);

  if (hues && !onPanel) {
    if (prevX === null) {
      newStroke();
      prevX = x;
      prevY = y;
    } else if (dist(prevX, prevY, x, y) >= MIN_STEP) {
      paintStroke(prevX, prevY, x, y, hues, ...tone);
      prevX = x;
      prevY = y;
    }
  } else {
    // lift the brush off the canvas and dip it back in the paint
    prevX = null;
    prevY = null;
    load = 1;
    speedWeight = 1;
    travel = 0;
  }

  flushDabs();
  renderImpasto();

  // cursor, so you can see where your finger is when not painting
  cursorDot.position(x, y);
  cursorDot.elt.classList.toggle("painting", !!hues && !onPanel);

}



 function keyPressed() {

  // If you hit the s key, save an image (just the paint, on a transparent background)
  if (key == 's') {
    save("mySketch.png");
  }

  // [ and ] to make the brush smaller or bigger
  if (key == '[') brushSize = max(0.4, brushSize - 0.1);
  if (key == ']') brushSize = min(3, brushSize + 0.1);
  if (key == '[' || key == ']') updateSizeFill();


 }
