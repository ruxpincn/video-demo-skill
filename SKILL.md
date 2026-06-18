---
name: 视频演示
description: Create or update screenshot-based hotspot operation tutorial webpages and export polished 1080P videos. Use when the user provides UI screenshots or hotspot images and asks for an animated webpage tutorial, precise click/scroll/highlight effects, Chinese explanation boxes, zoom page transitions, normal-aspect video with black bars instead of stretching, or post-produced click and transition sound effects.
---

# 视频演示

## Success Standard

Treat this as a precision video-production task, not a generic webpage task. The output is successful only when:

- Hotspot boxes align to the intended UI element in source-image pixels.
- The selected content is brightened or preserved, never made darker than its surroundings.
- Clicks are obvious: the mouse moves to the target first, then performs a visible press.
- Page changes after clicks use a zoom-open webpage transition.
- Scroll cues are centered and followed by an up/down page-scroll camera transition.
- The black explanation box uses a yellow title and white body text, is large enough to read, and never covers the active highlighted content.
- On 4K exports, all tutorial overlay materials are scaled for final viewing: explanation labels, arrows, cursor, frames, zoom previews, and nav title pops must not remain at small 1080P review sizes.
- Overlay materials must not fight each other: no label, arrow, cursor, zoom preview, or frame should cover another active explanation box or the content being explained, and labels should stay visually close to their target.
- Higher frame rate must not make the demonstration faster. Preserve the approved timeline duration when exporting 50fps or higher.
- Overlay effects are cleanly scoped: frames, labels, zoom previews, arrows, mouse states, page-zoom layers, and dim/highlight layers must not remain visible after the next page or next step starts.
- Guide/control panels such as "信谛听证据链查看流程" are hidden in the final tutorial view and video.
- Final video is at least 1920x1080, uses the requested/highest source-aligned frame rate, keeps the webpage's natural aspect ratio, uses black bars if needed, and includes audio in the exported video rather than relying on browser playback.

Before implementing a similar tutorial, read [requirements-map.md](references/requirements-map.md) for the exact requirement-to-method mapping from the successful hotspot tutorial.

## Build Workflow

1. Inspect the provided screenshots and record their natural dimensions.
2. Define every hotspot as `{ x, y, w, h, source }` in source-image pixels, not viewport guesses.
3. Build one full-screen stage with stacked screenshot images and overlay layers for dimming, selected-content brightening, frames, labels, mouse cursor, zoom previews, scroll cues, and page transitions.
4. Encode the tutorial as an ordered timeline of actions: `settle`, `navTour`, `frame`, `zoom`, `click`, `zoomTransition`, `scroll`, `scrollPageTransition`, and `complete`.
5. Give every key sub-step at least 1 second of complete display before moving on. For inspection steps, use a frame display followed by a 2 second zoom preview when the user asks for close-up emphasis.
6. Run the page in a recording mode that hides guide UI and exposes `window.__hotspotTutorial.playStep(index)`.
7. Let the user preview and approve the webpage before exporting video when they are still adjusting layout, timing, wording, or effects. Do not rush to export on every small visual tweak.
8. After any webpage, timing, layout, copy, frame, cursor, arrow, zoom, or transition edit, run a residual-effects audit before the final response, even when the user only asked for a webpage preview and no video export.
9. Export with `scripts/export_hotspot_tutorial_video.mjs` only after the webpage is approved or the user explicitly asks for video.
10. Verify with extracted frames and `ffprobe` before telling the user it is done. For high-fps exports, compare the final duration against the page timeline/event JSON so raising fps did not compress the tutorial.

## Interaction Rules

- For nav tours, move the mouse from left to right across each nav title. Enlarge the title in place by about 1.5x with glow. Do not float a duplicate far away from the original text.
- For final nav selection, leave the mouse on the target and perform a click action.
- For ordinary clicks, move the cursor to the center of the target box, lower opacity while moving, then play a press animation. Do not use red dot click markers.
- If cropping a short word is unreliable, do not magnify the word. Click the target directly instead.
- For all click-result page changes, use `zoomTransition` from the clicked box to the next screenshot.
- For scroll steps, place the arrow at the visual center of the page, make it large and luminous, then transition to the next screenshot by scrolling down or up. When the user asks for a large scroll cue, size the arrow from the active screen height, e.g. `2/3` of screen height, and compute centering from the actual rendered `offsetWidth/offsetHeight`.
- Down arrows need an actual downward motion; up arrows need an actual upward motion. Do not use only pulse/scale animation when direction is the point being taught.
- For 4K delivery, use a dedicated recording/export media query or equivalent large-screen style so cursor, arrows, frames, labels, zoom previews, and nav pops are all readable at 4K.

## Highlight And Label Rules

- Use a dim layer only outside the selected region. Repaint the selected region with the same screenshot as a `focus-highlight` layer so the selected content stays bright.
- Use dashed or refined highlight frames that blink three times when requested. Remove circular white glow effects inside the selected area.
- Keep the black explanation label visually attached to the highlighted content: close to the target edge, but not covering it. Do not push labels to remote corners just to avoid overlap.
- Use a full-size label for normal page sections and a compact label only when side margins are narrow around a large modal. Compact still needs to be prominent.
- Use this successful label style as a baseline: black translucent background, yellow title, white body, strong border/shadow, title around 26px and body around 19px on a 1920px-wide video; compact modal labels can use around 23px/17px.
- Re-check label placement after changing font size; a readable label that covers the target is still a failed label.
- Clear labels and frames before a zoom-preview close-up when the enlarged preview would overlap them. Treat the frame/label and close-up preview as consecutive beats, not competing simultaneous overlays.
- For a final conclusion callout, remove redundant prefix words such as "结论页"; use a short title such as "三件事". Show the final page cleanly for about 2 seconds before revealing the conclusion callout. Use a dedicated large centered callout, slightly above center, with text larger than normal explanation labels but not oversized.

## Overlay Cleanup Rules

- Use one cleanup function for the shared overlay stack: dim, focus highlight, frame, black label, scroll cue, scroll arrow, zoom preview, page zoom, nav pop, and mouse classes.
- Call cleanup at the start of every `settle`, before starting a zoom preview, before starting a new scroll cue, before and after `zoomTransition`, after `zoom` preview finishes, and after scroll page transitions complete.
- When checking for residue, sample both (1) the first moment of each step and (2) post-action moments after zoom previews, scroll transitions, and page zoom transitions. Look for lingering `visible`, `active`, `show`, `press`, `moving`, `scroll-current`, or `scroll-next` classes.
- Every edit turn must include a cleanup audit before replying: preview the changed step and the immediately following step, then inspect screenshots or runtime DOM state for leftover dim layers, focus highlights, frames, labels, scroll cues/arrows, zoom previews, page zoom layers, nav pops, mouse states, and temporary image scroll classes. If the audit cannot be run, say that explicitly instead of implying the page is clean.
- Treat active overlays during their intended animation window as normal. Treat any overlay remaining after the next screenshot is cleanly active as a bug.

## Page Contract

The export script expects the tutorial page to provide:

```js
window.__HOTSPOT_RECORDING_MODE // set before page load by the recorder
window.__hotspotTutorial = {
  steps,
  playStep(index),
  advance()
}
window.__recordTutorialEvent({ type, ...detail }) // called by click/zoom/scroll transitions
```

When `window.__HOTSPOT_RECORDING_MODE` is true, the page must:

- Add or honor a `recording-export` class.
- Hide guide panels, controls, end cards, and other non-video UI.
- Keep the stage black and the screen aspect-ratio constrained so the video is not stretched.
- Load all screenshot assets before starting playback.

## Export

Use the bundled script after the page works interactively:

```bash
cd /path/to/视频演示
node scripts/export_hotspot_tutorial_video.mjs \
  --root "/path/to/tutorial-folder" \
  --out "/path/to/tutorial-folder/exports/tutorial-1080p-with-sfx.mp4"
```

The script starts a local static server when `--url` is not provided, launches a temporary headless Chrome via CDP, records each `playStep(index)`, time-aligns captured frames to the page timeline by duplicating the latest frame when 4K capture cannot keep up, writes click/zoom/scroll events to JSON, synthesizes clean sound effects, and muxes them into the final MP4. For 4K high-fps delivery such as 50fps, first export a correct-timing 4K master at a stable capture frame rate, then convert that master to the requested frame rate with ffmpeg `fps=50`; do not let the final frame rate change the video duration.

Useful options:

- `--url http://127.0.0.1:8073/` to use an already-running local server.
- `--width 3840 --height 2160 --fps 20 --crf 18` for a stable correct-timing 4K master, then convert to 50fps when requested.
- `--width 1920 --height 1080 --fps 50 --crf 20` for a lighter 1080P review export.
- `ffmpeg -i master.mp4 -vf "fps=50" -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a copy final-50fps.mp4` for a 50fps final without changing duration.
- `--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` when Chrome is not auto-detected.

## Verification

Always verify before final response:

```bash
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration -of json "<video.mp4>"
```

Then extract a contact sheet of key frames:

```bash
ffmpeg -y -hide_banner -loglevel error -i "<video.mp4>" \
  -vf "select='eq(n\\,190)+eq(n\\,274)+eq(n\\,348)',scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,tile=3x1" \
  -frames:v 1 /tmp/hotspot-check.jpg
```

Inspect the sheet visually. Confirm no guide box remains, highlighted areas are aligned, explanation labels do not cover the active content, click-result transitions are zoom-open effects, scroll arrows are centered, and the audio stream exists.
