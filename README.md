# 视频演示 Skill

Codex skill for building screenshot-based operation tutorials and exporting polished videos with precise highlights, cursor motion, zoom-open page transitions, scroll cues, residual-effect audits, and post-produced sound effects.

## Contents

- `SKILL.md` - main operating instructions and success standards.
- `references/requirements-map.md` - requirement-to-method checklist distilled from the approved tutorial.
- `scripts/export_hotspot_tutorial_video.mjs` - browser capture, event recording, sound synthesis, and MP4 export script.
- `agents/openai.yaml` - display metadata for the skill.

## Use

Install or copy this folder as:

```bash
~/.codex/skills/视频演示
```

Then ask Codex to use `$视频演示` for screenshot tutorials, webpage previews, or final 1080P/4K video exports.

For video export from a completed tutorial page:

```bash
cd ~/.codex/skills/视频演示
node scripts/export_hotspot_tutorial_video.mjs \
  --root "/path/to/tutorial-folder" \
  --out "/path/to/tutorial-folder/exports/tutorial-1080p-with-sfx.mp4"
```

Always preview the webpage first, then export only after layout, timing, labels, and residual effects have been checked.
