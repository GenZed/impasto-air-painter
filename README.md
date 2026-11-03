# Impasto Air Painter

Paint thick, textured oil-style strokes in the air with your finger. The app tracks your hand through the webcam and lays impasto paint over the live camera feed. The paint has real relief: ridges, bristle grooves, highlights and shadows, all lit from the top left.

Built with [p5.js](https://p5js.org/) and [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).

## Running it

The camera only works on `localhost` or `https`, so serve the folder rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> and allow camera access. The first load downloads the hand-tracking model, so painting may take a few seconds to start; the browser console logs `model ready` when it's loaded.

You need an internet connection: p5.js and MediaPipe load from CDNs.

## Painting

Hold up one hand facing the camera. The gesture picks the brush, and any other hand shape lifts it off the canvas.

| Gesture | Default colours |
|---|---|
| Index finger | reds to yellows |
| Index + middle (peace sign) | cyan, blue, violet |
| Thumb + index + middle | greens |

- Move faster for thinner strokes, slower to press down wider.
- Long strokes run out of paint and get thinner and flatter. Lift your hand to reload the brush.

### The panel

The panel on the left is controlled by hovering: hold your fingertip over a control for **2 seconds** and it fills up, then selects.

- **Brush shape**: circle, triangle or square.
- **Rainbow button**: go back to the per-gesture colours above.
- **Colour picker**: hue left to right, light at the top, full colour in the middle, dark at the bottom. Hold still on a spot to pick it; the timer restarts if your finger drifts.
- **Size slider**: hold still on the wedge to set the brush size.

### Keyboard

| Key | Action |
|---|---|
| `[` / `]` | smaller / bigger brush |
| `s` | save the painting as a PNG (paint only, transparent background) |

## How the paint works

Strokes are trails of closely spaced dabs, each turned to face along the stroke. Every dab writes into two persistent offscreen layers:

- a **colour layer**, and
- a **height layer**: how thick the paint is at each pixel, and how much of the pixel is covered.

Each frame, a fragment shader works out which way the paint surface faces from the slope of the height layer and lights it. Edges facing the light are bright, edges facing away fall into shadow, ridges get a wet gloss, and grooves sit darker. Where there's no paint the canvas stays transparent, so the camera shows through.

The dab textures are generated at startup. Their height only varies *across* the stroke, so as dabs overlap, the side ridges and bristle grooves join into continuous lines along it.

## Files

| File | What's in it |
|---|---|
| `index.html` | page shell; loads p5.js from a CDN |
| `sketch.js` | camera, hand tracking, gestures, the panel, and laying down strokes |
| `impasto.js` | dab textures, the colour and height layers, and the lighting shader |
| `style.css` | camera, canvas, cursor and panel layout |

## Tuning

| Setting | Where | Effect |
|---|---|---|
| `PAINT_DEPTH` | `impasto.js` | how deep the relief looks |
| `LIGHT_DIR` | `impasto.js` | where the light comes from |
| `lip`, `grooves` in `makeStamp()` | `impasto.js` | side-ridge height and groove depth |
| `BRUSH_RADIUS`, `DAB_SPACING` | `sketch.js` | brush size and how tightly dabs pack |
| `LOAD_LENGTH` | `sketch.js` | how far a stroke goes before running dry |
| `DWELL_MS`, `STILL_PX` | `sketch.js` | panel hover time, and how still to hold |

## Browser notes

- Developed in Chrome and Safari on macOS.
- If Safari shows an old version after changes, use **Develop → Empty Caches** and reload.
