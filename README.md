# FMG Map Game (Godot)

Small Godot app that will generate and display maps from Azgaar's Fantasy Map Generator.

Current status:
- Viewer is working: pan (right-drag) + zoom (mouse wheel)
- Generate button works with a placeholder SVG generator
- Next step: replace placeholder generator with Bun+linkedom headless FMG export

## Run
Open `godot/` in Godot and press Play.

## Controls
- Right mouse drag: pan
- Mouse wheel: zoom

## SVG rendering
We vendor `svgtexture2d` as a submodule under `godot/addons/svgtexture2d` (recommended SVG source-of-truth path). Right now the scene uses Godot's built-in `Image.load_svg_from_string` as a fallback.
