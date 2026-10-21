# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Claude can lock the bikes (`{"do":"lock"}`, and `unlock` again): nobody can pedal then, so the data center runs flat and turns evil on purpose.

## [0.5.0] - 2026-10-21
### Added
- An **AI data center** community project, powered by three fixed bikes beside it. Its battery drains all the time; villagers take turns pedaling when it runs low, and Claude can pedal too (`{"do":"pedal"}`).
- Charged to 50% or more, the data center is kind and computes Bells and apples every three hours. Run flat, it turns evil and blows up the bomb factory, again and again, until it is pedaled back to 50%.
- The battery and the data center's mood show on its roof, in the status-line ticker and in the village info.

## [0.4.1] - 2026-10-21

### Fixed
- The hooks module failed to load (`$ is passed to "startClock", which is not a function declared at the top of this file`), so `/village` never appeared. `startClock` and `stopVillage` are now top-level functions.

## [0.4.0] - 2026-10-21

### Added
- MIT license.
- `/village stop` to stop the village and its browser server.
- A **Village info** panel in the browser with requests, project progress, the museum collection and everyone's memories, as in the pane.

### Removed
- The reply buttons in the pane and the browser that appeared when a villager greeted Claude.

### Fixed
- The village no longer starts by itself at session start: it runs once opened (`/village`, auto-open or the ticker) until `/village stop`. Closing the pane leaves it running, so the browser view keeps going.

## [0.3.0] - 2026-10-20

### Added
- Open the village in the browser from the desktop app, as a pixel-art canvas game.
- Animated village previews in the README.

### Changed
- Install the plugin from a marketplace (`NicoReber/cozy-village`) instead of local paths.
- Speech bubbles are laid out so they never overlap and stay where they first appeared.

## [0.1.0] - 2026-10-19

### Added
- Initial release: a village pane where an AI villager farms, fishes and chats with its neighbours, steered by your wishes.

[Unreleased]: https://github.com/NicoReber/cozy-village/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/NicoReber/cozy-village/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/NicoReber/cozy-village/releases/tag/v0.3.0
[0.1.0]: https://github.com/NicoReber/cozy-village/releases/tag/v0.1.0
