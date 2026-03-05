extends Control

@onready var btn: Button = $UI/GenerateButton
@onready var status: Label = $UI/Status
@onready var cam: Camera2D = $World/Camera
@onready var sprite: Sprite2D = $World/Sprite

var dragging := false
var last_mouse := Vector2.ZERO

const SVG_PATH := "res://generated/latest.svg"

func _ready() -> void:
	btn.pressed.connect(_on_generate_pressed)
	_load_svg()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e := event as InputEventMouseButton
		if e.button_index == MOUSE_BUTTON_RIGHT:
			dragging = e.pressed
			last_mouse = e.position
			get_viewport().set_input_as_handled()
		elif e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
			_zoom(0.9)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
			_zoom(1.1)
	elif event is InputEventMouseMotion and dragging:
		var m := event as InputEventMouseMotion
		cam.position -= m.relative / cam.zoom
		get_viewport().set_input_as_handled()

func _zoom(factor: float) -> void:
	var z := cam.zoom * factor
	z.x = clamp(z.x, 0.05, 10.0)
	z.y = clamp(z.y, 0.05, 10.0)
	cam.zoom = z

func _on_generate_pressed() -> void:
	status.text = "Generating..."
	# Placeholder generator: writes a simple SVG with random colors.
	# Next: replace this with bun+linkedom+FMG headless export.
	_generate_placeholder_svg()
	_load_svg()
	status.text = "Ready"

func _generate_placeholder_svg() -> void:
	var w := 2000
	var h := 1200
	var c1 := Color(randf(), randf(), randf()).to_html(false)
	var c2 := Color(randf(), randf(), randf()).to_html(false)
	var svg := """<svg xmlns='http://www.w3.org/2000/svg' width='%d' height='%d' viewBox='0 0 %d %d'>
	<rect x='0' y='0' width='%d' height='%d' fill='#%s'/>
	<circle cx='%d' cy='%d' r='%d' fill='#%s' opacity='0.6'/>
	<text x='40' y='80' font-size='64' fill='white'>FMG placeholder (wire real generator next)</text>
</svg>""" % [w,h,w,h,w,h,c1, w/2, h/2, min(w,h)/3, c2]
	var out_path := ProjectSettings.globalize_path("res://generated/latest.svg")
	var f := FileAccess.open(out_path, FileAccess.WRITE)
	f.store_string(svg)
	f.close()

func _load_svg() -> void:
	var abs_path := ProjectSettings.globalize_path(SVG_PATH)
	if not FileAccess.file_exists(abs_path):
		return
	var svg_str := FileAccess.get_file_as_string(abs_path)
	var img := Image.new()
	var err := img.load_svg_from_string(svg_str)
	if err != OK:
		status.text = "Failed to load SVG (err %d)" % err
		return
	var tex := ImageTexture.create_from_image(img)
	sprite.texture = tex
	# center sprite
	sprite.position = Vector2.ZERO
	# move camera to center
	cam.position = Vector2(img.get_width(), img.get_height()) * 0.5
