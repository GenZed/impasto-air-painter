// impasto paint - thick paint that keeps its own relief and is lit like a real surface.
// Paint goes into two hidden layers that persist between frames:
//   colourLayer - the paint colour
//   heightLayer - red = how thick the paint is, green = how much of the pixel is covered
// Every frame a shader works out which way each pixel of paint faces from the height
// layer and lights it, giving bright edges towards the light, shadows away from it,
// gloss on the peaks and darker grooves where the bristles dragged through.

const STAMP_PX = 128;      // resolution of the dab textures
const PAINT_DEPTH = 7;    // how strongly height turns into light and shadow
const LIGHT_DIR = [-0.5, -0.6, 0.65]; // from the top left, screen space (y down)

let colourLayer, heightLayer, impastoShader;
let stamps = {};   // per shape: a few { mask, height } texture pairs
let strokeVariant = 0;
let dabs = [];     // dabs queued this frame, stamped together in flushDabs()

function setupImpasto() {
  colourLayer = createFramebuffer({ depth: false });
  // half float so slopes in the paint don't band into steps
  heightLayer = createFramebuffer({ depth: false, format: HALF_FLOAT });
  colourLayer.draw(() => background(0));
  heightLayer.draw(() => background(0));

  impastoShader = createShader(IMPASTO_VERT, IMPASTO_FRAG);

  for (let s of SHAPES) stamps[s] = makeStamps(s);
}

function edgeStep(e0, e1, v) {
  let t = constrain((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// distance from the centre of a dab, 1 on its outline; u runs along the stroke, v across it
function shapeDistance(name, u, v) {
  if (name === "square") return max(abs(u), abs(v)) * 1.08;
  if (name === "triangle") {
    // points forward along the stroke, with rounded corners - sharp back corners
    // would stick out past the next dab and saw-tooth the sides of the stroke
    let round = 0.3;
    let edges = [-u - 0.6, 0.469 * u + 0.883 * v - 0.469, 0.469 * u - 0.883 * v - 0.469]
      .map((e) => e + round);
    let outside = sqrt(edges.reduce((sum, e) => sum + max(e, 0) ** 2, 0));
    let signed = (outside > 0 ? outside : max(...edges)) - round;
    return 1 + signed / 0.6;
  }
  return sqrt(u * u + v * v);
}

// a few groove patterns per shape, so strokes don't all carry the same ridges
function makeStamps(name) {
  return [0, 1, 2].map((seed) => makeStamp(name, seed * 37.1));
}

// two textures, drawn in the brush's own frame (u along the stroke, v across it):
//   mask   - white, alpha = the dab's ragged outline; tinted with the paint colour
//   height - red = paint thickness, green = coverage, same alpha
// The height only changes across the stroke (v), never along it: each dab paints over the
// last, so anything that changed along u would repeat dab after dab as ribbing
function makeStamp(name, seed) {
  let mask = createGraphics(STAMP_PX, STAMP_PX);
  let heightTex = createGraphics(STAMP_PX, STAMP_PX);
  mask.pixelDensity(1);
  heightTex.pixelDensity(1);
  mask.loadPixels();
  heightTex.loadPixels();

  for (let py = 0; py < STAMP_PX; py++) {
    for (let px = 0; px < STAMP_PX; px++) {
      let u = (px + 0.5) / STAMP_PX * 2 - 1;
      let v = (py + 0.5) / STAMP_PX * 2 - 1;
      let angle = Math.atan2(v, u);

      // ragged outline - a slow wobble all round, plus bristle ends sticking out. The
      // triangle's slanted sides would turn bristle ends into a saw edge, so it gets fewer
      let bristles = name === "triangle" ? 0.02 : 0.1;
      let rag = (noise(Math.cos(angle) * 1.5 + 10 + seed, Math.sin(angle) * 1.5 + 10) - 0.5) * 0.25
              + (noise(v * 18 + seed, 3) - 0.5) * bristles;
      let edge = shapeDistance(name, u, v) + rag;
      let alpha = 1 - edgeStep(0.72, 0.95, edge);

      // paint pushed aside piles up into a ridge along each side of the stroke
      let w = abs(v);
      let lip = edgeStep(0.4, 0.72, w) * (1 - edgeStep(0.72, 0.98, w));
      // broad bristle grooves running along the stroke, with a few finer ones
      let grooves = (noise(v * 3.5 + seed, 7) - 0.5) * 0.5 + (noise(v * 10 + seed, 9) - 0.5) * 0.15;
      let h = constrain(0.5 + 0.3 * lip + grooves, 0, 1);

      let i = 4 * (py * STAMP_PX + px);
      mask.pixels[i] = mask.pixels[i + 1] = mask.pixels[i + 2] = 255;
      mask.pixels[i + 3] = alpha * 255;
      heightTex.pixels[i] = h * 255;
      heightTex.pixels[i + 1] = 255;
      heightTex.pixels[i + 2] = 0;
      heightTex.pixels[i + 3] = alpha * 255;
    }
  }

  mask.updatePixels();
  heightTex.updatePixels();
  return { mask, height: heightTex };
}

// call when the brush goes down - picks this stroke's groove pattern
function newStroke() {
  strokeVariant = floor(random(3));
}

// queue one dab: centre, radius, stroke angle (degrees), colour, thickness 0-1
function addDab(x, y, r, angle, colour, thickness) {
  dabs.push({ x, y, r, angle, colour, thickness });
}

// stamp this frame's dabs into both layers - batched so each layer is only bound once
function flushDabs() {
  if (dabs.length === 0) return;
  let s = stamps[shape][strokeVariant];

  colourLayer.draw(() => stampAll((d) => {
    tint(d.colour);
    image(s.mask, 0, 0, d.r * 2, d.r * 2);
  }));
  heightLayer.draw(() => stampAll((d) => {
    // thin paint stamps lower; green (coverage) stays full
    tint(255 * d.thickness, 255, 255);
    image(s.height, 0, 0, d.r * 2, d.r * 2);
  }));

  dabs = [];
}

function stampAll(drawDab) {
  push();
  colorMode(RGB, 255);
  imageMode(CENTER);
  translate(-width / 2, -height / 2); // WEBGL origin is the centre
  for (let d of dabs) {
    push();
    translate(d.x, d.y);
    rotate(d.angle);
    drawDab(d);
    pop();
  }
  pop();
  colorMode(HSB);
}

// light the paint onto the main canvas; the canvas is transparent where there's no paint
function renderImpasto() {
  clear();
  shader(impastoShader);
  impastoShader.setUniform("uColour", colourLayer);
  impastoShader.setUniform("uHeight", heightLayer);
  impastoShader.setUniform("uTexel", [1 / (width * pixelDensity()), 1 / (height * pixelDensity())]);
  impastoShader.setUniform("uDepth", PAINT_DEPTH);
  impastoShader.setUniform("uLight", LIGHT_DIR);
  blendMode(REPLACE); // the shader writes finished, premultiplied pixels
  plane(width, height);
  blendMode(BLEND);
  resetShader();
}

function clearImpasto() {
  colourLayer.draw(() => background(0));
  heightLayer.draw(() => background(0));
}

const IMPASTO_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

const IMPASTO_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uColour;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uDepth;
uniform vec3 uLight;

void main() {
  vec2 uv = vTexCoord;
  vec4 hc = texture2D(uHeight, uv);
  float cover = hc.g;
  if (cover < 0.004) {
    gl_FragColor = vec4(0.0);
    return;
  }
  // colour was blended over black, so divide the coverage back out
  vec3 base = texture2D(uColour, uv).rgb / cover;

  // slope of the paint from its neighbours -> the way the surface faces
  vec2 o = uTexel * 2.0;
  float hl = texture2D(uHeight, uv - vec2(o.x, 0.0)).r;
  float hr = texture2D(uHeight, uv + vec2(o.x, 0.0)).r;
  float hu = texture2D(uHeight, uv - vec2(0.0, o.y)).r;
  float hd = texture2D(uHeight, uv + vec2(0.0, o.y)).r;
  vec3 n = normalize(vec3((hl - hr) * uDepth, (hu - hd) * uDepth, 1.0));

  vec3 l = normalize(uLight);
  float diffuse = max(dot(n, l), 0.0);
  // wet gloss on the peaks and ridges facing the light
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float gloss = pow(max(dot(n, h), 0.0), 60.0) * 0.55;
  // grooves and thin paint sit a little in shadow
  float hollow = mix(0.78, 1.0, smoothstep(0.15, 0.6, hc.r));

  vec3 lit = base * (0.42 + 0.75 * diffuse) * hollow + gloss;
  gl_FragColor = vec4(lit * cover, cover);
}`;
