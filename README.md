# 视频演示 Skill

Codex skill for building screenshot-based operation tutorials and exporting polished videos with precise highlights, cursor motion, zoom-open page transitions, scroll cues, residual-effect audits, and post-produced sound effects.

The display name is `视频演示`. The installable skill name is `video-demo` because Codex skill names must use lowercase letters, digits, and hyphens.

## Contents

- `video-demo/` - installable Skill directory for GitHub installs.
- `SKILL.md` - local copy used by this machine's Codex skill directory.
- `references/requirements-map.md` - requirement-to-method checklist distilled from the approved tutorial.
- `scripts/export_hotspot_tutorial_video.mjs` - browser capture, event recording, sound synthesis, and MP4 export script.
- `agents/openai.yaml` - display metadata for the skill.

## Use

Install or copy this folder as:

```bash
~/.codex/skills/video-demo
```

Then ask Codex to use `$video-demo` for screenshot tutorials, webpage previews, or final 1080P/4K video exports.

Install from GitHub with:

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo ruxpincn/video-demo-skill \
  --path video-demo
```

For video export from a completed tutorial page:

```bash
cd ~/.codex/skills/video-demo
node scripts/export_hotspot_tutorial_video.mjs \
  --root "/path/to/tutorial-folder" \
  --out "/path/to/tutorial-folder/exports/tutorial-1080p-with-sfx.mp4"
```

Always preview the webpage first, then export only after layout, timing, labels, and residual effects have been checked.
