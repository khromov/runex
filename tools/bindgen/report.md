# Binding report

Generated: 235 classes, 81 records, 109 enums, 2273 methods, 109 functions, 404 constants.

Skipped: 165 items.

## parameter type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"generic":"T"}}],"constraints":[]}}}} (18)

- `rune_motion::AnimationStore::animate`
- `rune_motion::AnimationStore::animate_with_velocity`
- `rune_motion::AnimationStore::get`
- `rune_motion::AnimationStore::has`
- `rune_motion::AnimationStore::is_animating`
- `rune_motion::AnimationStore::play_keyframes`
- `rune_motion::AnimationStore::release`
- `rune_motion::AnimationStore::remove`
- `rune_motion::AnimationStore::sample`
- `rune_motion::AnimationStore::sample_velocity`
- `rune_motion::AnimationStore::set`
- `rune_motion::AnimationStore::target`
- `rune_motion::AnimationStore::track_id`
- `rune_motion::AnimationStore::velocity`
- `rune_motion::Ops::animate`
- `rune_motion::Scene::animate`
- `rune_motion::Scene::get`
- `rune_motion::Scene::set`

## reference to {"resolved_path":{"path":"wgpu::Device","args":null}} (14)

- `rune_fx::FxRenderer::add_format`
- `rune_fx::FxRenderer::blur_backdrop`
- `rune_fx::FxRenderer::build_mips`
- `rune_fx::FxRenderer::new`
- `rune_fx::FxRenderer::prepare`
- `rune_fx::FxRenderer::prepare_with_slots`
- `rune_fx::FxRenderer::set_fire_sim`
- `rune_fx::FxRenderer::set_layer_backdrop`
- `rune_fx::MaskPyramid::new`
- `rune_light::GlassRenderer::new`
- `rune_light::GlassRenderer::render`
- `rune_light::LightRenderer::new`
- `rune_light::LightRenderer::read_timings`
- `rune_light::LightRenderer::render`

## generic over something other than the app state (9)

- `rune::live::Binding`
- `rune_fx::OneShot`
- `rune_fx::OneShots`
- `rune_motion::Animated`
- `rune_motion::Keyframe`
- `rune_motion::Keyframes`
- `rune_motion::Prop`
- `rune_motion::Release`
- `rune_motion::VelocityTracker`

## returns Option of a reference (8)

- `rune::DragItem::png_data`
- `rune::dirs::AppDirs::downloads`
- `rune::dirs::AppDirs::home`
- `rune::text::Atlas::page_data`
- `rune_kit::ShortcutRecorderState::refused`
- `rune_kit::ShortcutRecorderState::shortcut`
- `rune_motion::AnimationStore::values_of`
- `rune_motion::Scene::trace_mut`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"primitive":"f32"}}],"constraints":[]}}}} (5)

- `rune_motion::prop::BLUR`
- `rune_motion::prop::OPACITY`
- `rune_motion::prop::PRESENCE`
- `rune_motion::prop::ROTATION`
- `rune_motion::prop::SCALE`

## Option of a reference (4)

- `rune::Play::record_rewind (via Deref)`
- `rune::TextEdit::key`
- `rune::Tx::record_rewind`
- `rune_kit::shortcut_error_message`

## callback result {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"borrowed_ref":{"lifetime":"'static","is_m (4)

- `rune::El::pill_icon`
- `rune_kit::TextArea::pill_icon`
- `rune_kit::TextField::pill_icon`
- `rune_kit::TextInput::pill_icon`

## callback result {"generic":"T"} (4)

- `rune::Cx::layout_with`
- `rune::Cx::window_layout_with`
- `rune::memo::layout_with`
- `rune::memo::window_layout_with`

## return type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::time::Inst (3)

- `rune::Play::input_time (via Deref)`
- `rune::Tx::input_time`
- `rune::last_input`

## parameter type {"resolved_path":{"path":"crate::live::Binding","args":{"angle_bracketed":{"args":[{"type":{"primitive":"f32"}}],"constr (3)

- `rune::El::live_blur`
- `rune::El::live_opacity`
- `rune::El::live_scale`

## parameter type {"resolved_path":{"path":"crate::live::Binding","args":{"angle_bracketed":{"args":[{"type":{"array":{"type":{"primitive" (3)

- `rune::El::live_offset`
- `rune::El::live_rect`
- `rune::El::live_trim`

## async (3)

- `rune::FileDialogs::open`
- `rune::FileDialogs::open_folder`
- `rune::FileDialogs::save`

## returns TreeRow, which borrows (3)

- `rune_kit::TreeRow::expanded`
- `rune_kit::TreeRow::new`
- `rune_kit::TreeRow::selected`

## reference to {"resolved_path":{"path":"wgpu::RenderPass","args":{"angle_bracketed":{"args":[{"lifetime":"'_"}],"constraints":[]}}}} (3)

- `rune_fx::FxRenderer::draw_all`
- `rune_fx::FxRenderer::draw_layer`
- `rune_fx::FxRenderer::draw_layer_in`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::value::Vec2" (3)

- `rune_motion::prop::OFFSET`
- `rune_motion::prop::SCROLL`
- `rune_motion::prop::TRAVEL`

## reference to {"resolved_path":{"path":"parley::Layout","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"super::In (3)

- `rune::text::last_line_fill`
- `rune::text::layout_height`
- `rune::text::stream_height_lag`

## returns a reference to non-Clone rune_motion::AnimationStore (2)

- `rune_motion::Scene::store`
- `rune_motion::Scene::store_mut`

## returns rune_motion::FrameOutput<'static>, which borrows (2)

- `rune_motion::Scene::frame`
- `rune_motion::Scene::frame_at`

## return type {"generic":"R"} (2)

- `rune::TextEdit::undo_group`
- `rune::theme::with_blend`

## return type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::PhysicalKe (2)

- `rune::Play::physical_key (via Deref)`
- `rune::Tx::physical_key`

## callback result {"resolved_path":{"path":"Cow","args":{"angle_bracketed":{"args":[{"lifetime":"'a"},{"type":{"primitive":"str"}}],"const (2)

- `rune::El::virtual_rows`
- `rune_kit::Sidebar::virtual_rows`

## parameter type {"slice":{"tuple":[{"primitive":"f32"},{"resolved_path":{"path":"Color","args":null}}]}} (2)

- `rune::El::linear_gradient`
- `rune::El::radial_gradient`

## unsafe (2)

- `rune::native_surface::macos::PixelBuffer::from_iosurface`
- `rune::native_surface::macos::PixelBuffer::from_raw`

## parameter type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Shortcut","args": (2)

- `rune::Playground::shortcut`
- `rune_kit::ShortcutRecorderState::new`

## parameter type {"resolved_path":{"path":"Alignment","args":null}} (2)

- `rune::text::RichLayoutOptions::align`
- `rune::text::TextSystem::layout_aligned`

## reference to {"resolved_path":{"path":"Layout","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Ink","args":null} (2)

- `rune::text::TextSystem::decorations`
- `rune::text::TextSystem::glyphs_for_layout`

## return type {"resolved_path":{"path":"Rc","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Layout","args":{"angl (2)

- `rune::text::TextSystem::layout_rich`
- `rune::text::TextSystem::layout_rich_with`

## parameter type {"resolved_path":{"path":"Shortcut","args":null}} (2)

- `rune::MenuItem::key_equivalent`
- `rune::PopupItem::key_equivalent`

## callback argument {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"borrowed_ref":{"lifetime":null,"is_mutabl (2)

- `rune_kit::ShortcutRecorder::error_message`
- `rune_kit::ShortcutRecorder::on_change`

## return type {"generic":"F"} (2)

- `rune::edit_access`
- `rune::el::edit_access`

## IntoIterator without Item (1)

- `rune_motion::Choreography::stagger`

## bound Write + Send + 'static (1)

- `rune_motion::MotionTrace::new`

## return type {"resolved_path":{"path":"io::Result","args":{"angle_bracketed":{"args":[{"type":{"tuple":[]}}],"constraints":[]}}}} (1)

- `rune_motion::MotionTrace::flush`

## &mut {"resolved_path":{"path":"String","args":null}} (1)

- `rune_motion::TraceChannels::write_json`

## return type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Zeroizing","args" (1)

- `rune::clipboard::MemoryClipboard::text`

## callback result {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"OsString","args": (1)

- `rune::dirs::AppDirs::from_env`

## returns an iterator of items that borrow (1)

- `rune::TextEdit::pills`

## callback argument {"resolved_path":{"path":"std::path::Path","args":null}} (1)

- `rune::El::accepts_files`

## reference to {"resolved_path":{"path":"crate::Live","args":{"angle_bracketed":{"args":[{"type":{"array":{"type":{"primitive":"f32"}," (1)

- `rune::El::drawn_rect_into`

## bound std::hash::Hash (1)

- `rune::El::virtual_rows_version`

## reference to {"resolved_path":{"path":"crate::LiveText","args":null}} (1)

- `rune::El::live_text`

## parameter type {"resolved_path":{"path":"crate::live::Binding","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Col (1)

- `rune::El::live_fill`

## parameter type {"resolved_path":{"path":"FrameObserver","args":null}} (1)

- `rune::NativeSurface::set_observer`

## reference to {"resolved_path":{"path":"OverlaySpec","args":{"angle_bracketed":{"args":[{"type":{"generic":"P"}}],"constraints":[]}}}} (1)

- `rune::Story::overlay`

## return type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Language","args": (1)

- `rune::text::TextSystem::language`

## parameter type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"Language","args": (1)

- `rune::text::TextSystem::set_language`

## return type {"resolved_path":{"path":"Rc","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"RunLayout","args":nul (1)

- `rune::text::TextSystem::run_layout`

## reference to {"resolved_path":{"path":"Runtime","args":{"angle_bracketed":{"args":[{"type":{"generic":"S"}}],"constraints":[]}}}} (1)

- `rune::AccessibilityLink::service`

## variant fields can't convert (1)

- `rune::PhysicalInput::Key`

## sequence of {"tuple":[{"generic":"I"},{"generic":"T"}]} (1)

- `rune::PopupMenu::picker`

## return type {"resolved_path":{"path":"SurfaceStats","args":null}} (1)

- `rune::WindowHandle::surface_stats`

## callback argument {"resolved_path":{"path":"winit::raw_window_handle::WindowHandle","args":{"angle_bracketed":{"args":[{"lifetime":"'a"}], (1)

- `rune::WindowHandle::with_raw_handle`

## sequence of an unsupported bound (1)

- `rune_kit::Markdown::highlights`

## sequence of {"tuple":[{"primitive":"usize"},{"generic":"K"}]} (1)

- `rune_kit::Markdown::block_keys`

## callback result {"resolved_path":{"path":"Vec","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::syntax::Highl (1)

- `rune_kit::Markdown::highlight`

## parameter type {"resolved_path":{"path":"Highlighter","args":null}} (1)

- `rune_kit::Markdown::highlighter`

## parameter type {"resolved_path":{"path":"Syntax","args":null}} (1)

- `rune_kit::MarkdownStyle::syntax`

## parameter type {"resolved_path":{"path":"SyntaxTheme","args":null}} (1)

- `rune_kit::MarkdownStyle::syntax_theme`

## sequence of {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"generic":"S"}}],"constraints":[]}}}} (1)

- `rune_kit::Select::details`

## parameter type {"resolved_path":{"path":"std::cmp::Ordering","args":null}} (1)

- `rune_kit::SortDir::apply`

## callback result {"borrowed_ref":{"lifetime":null,"is_mutable":false,"type":{"resolved_path":{"path":"TableState","args":null}}}} (1)

- `rune_kit::Table::new`

## callback result rune_kit::Cell has no default for when the callback throws (1)

- `rune_kit::Table::cell`

## reference to {"generic":"S"} (1)

- `rune_kit::Table::build`

## parameter type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"impl_trait":[{"trait_bound":{"trait":{"pa (1)

- `rune_kit::TextInput::active_descendant`

## rune_kit::TreeRow<'static> only exists inside callbacks (1)

- `rune_kit::TreeItem::build`

## reference to {"resolved_path":{"path":"wgpu::Queue","args":null}} (1)

- `rune_fx::FxRenderer::simulate`

## return type {"resolved_path":{"path":"wgpu::TextureFormat","args":null}} (1)

- `rune_fx::MaskPyramid::FORMAT`

## returns a reference to {"resolved_path":{"path":"wgpu::Texture","args":null}} (1)

- `rune_light::LightRenderer::visibility_texture`

## returns rune_light::Inspect<'static>, which borrows (1)

- `rune_light::LightRenderer::inspect`

## return type {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"BTreeMap","args": (1)

- `rune_knobs::Knobs::preset`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::value::Rect" (1)

- `rune_motion::prop::FRAME`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::value::Corne (1)

- `rune_motion::prop::RADIUS`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::value::Color (1)

- `rune_motion::prop::FILL`

## return type {"resolved_path":{"path":"Prop","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"crate::value::Sides (1)

- `rune_motion::prop::MASK`

## callback result {"resolved_path":{"path":"Option","args":{"angle_bracketed":{"args":[{"type":{"resolved_path":{"path":"std::ffi::OsStrin (1)

- `rune::dirs::home_from`

## return type {"resolved_path":{"path":"std::cmp::Ordering","args":null}} (1)

- `rune_kit::natural_cmp`

## returns impl Trait (1)

- `rune_knobs::side_key`

## Bound under #[cfg]: absent from the addon on other platforms (2)

- `rune::NativeSurface::push`: `cfg(target_os = "macos")`
- `rune::native_surface::macos::PixelBuffer`: `cfg(target_os = "macos")`
