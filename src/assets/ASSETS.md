# Bundled Assets

All assets are stored locally in this repository. Nothing is hotlinked and no
CDN is used at runtime.

## Fonts

### Marcellus (Regular 400)

- Files: `fonts/marcellus-latin.woff2`, `fonts/marcellus-latin-ext.woff2`
- Designer: Brian J. Bonislawsky (Astigmatic)
- Source: Google Fonts, https://fonts.google.com/specimen/Marcellus
  (downloaded 2026-07-20 from fonts.gstatic.com, family version v14)
- License: SIL Open Font License 1.1 (OFL),
  https://openfontlicense.org (free for commercial use, embedding, and
  redistribution with software).
- Usage: display face for the "Salon privé" visual theme only (headings,
  table message, bankroll figures). Declared with `font-display: swap`;
  browsers download it only when the theme actually uses it.
- Size: ~23 KB total (two woff2 subsets: latin + latin-ext, covering
  English and French including œ/Œ).

## Logo

The Blackjack Lab identity lives in `logo/` and is an original work created
for this project (same terms as the project; no third-party artwork used):

- `logo/mark.svg`: the compact mark, the "dissected spade", one half solid
  ink, the other half a fine gold construction outline split by a hairline
  seam (the casino and the lab reading the same card). Adapts to the OS
  color scheme via `prefers-color-scheme`; intended for standalone use
  (documentation, about screens).
- `logo/logo-full.svg`: the primary horizontal lockup, mark plus the
  "BLACKJACK LAB" wordmark. The wordmark letterforms were outlined to
  vector paths from the locally bundled Marcellus font (SIL Open Font
  License 1.1, see Fonts above; the OFL permits embedding and conversion),
  so the file is fully self-contained and needs no font at render time.
- `logo/favicon.svg`: the app icon, a solid ivory spade with the gold seam
  on a bordeaux plate with a fine brass keyline, legible at 16 px in both
  light and dark tab strips.

The header in `index.html` embeds the mark inline (rather than as an
`<img>`) so it colors itself from the active theme tokens (`currentColor`
and `--gold`) instead of the OS color scheme.

## Audio

All audio lives under `audio/` and is loaded only by
`src/js/audio/audioManager.js`. Every file was re-encoded locally with
ffmpeg (44.1 kHz MP3; effects are mono, peak-normalized to −3 dBFS with
leading silence trimmed; the music track is stereo, loudness-normalized
with `loudnorm I=-17`).

### Music

#### "Lobby Time" by Kevin MacLeod

- File: `audio/music/lobby-time.mp3`
- Original title: Lobby Time
- Creator: Kevin MacLeod (incompetech.com)
- Source / original URL:
  https://incompetech.com/music/royalty-free/mp3-royaltyfree/Lobby%20Time.mp3
  (downloaded 2026-07-20)
- License: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/ (free for commercial
  use and redistribution with attribution).
- Attribution: "Lobby Time" Kevin MacLeod (incompetech.com),
  Licensed under Creative Commons: By Attribution 4.0.
- Technical modifications: re-encoded from 256 kbps to VBR ~130 kbps and
  loudness-normalized, with no change to the musical composition.
- Usage: background music, crossfade-looped at runtime.

### Card and chip sound effects from Kenney's "Casino Audio" pack

- Files: `audio/cards/deal-1..4.mp3` (from `card-slide-1/2/3/5.ogg`),
  `audio/cards/reveal-1..2.mp3` (from `card-place-1/2.ogg`),
  `audio/cards/shove-1..2.mp3` (from `card-shove-1/2.ogg`),
  `audio/cards/shuffle.mp3` (from `card-shuffle.ogg`),
  `audio/chips/add-1..3.mp3` (from `chip-lay-1/2/3.ogg`),
  `audio/chips/stack-1..2.mp3` (from `chips-stack-2/4.ogg`),
  `audio/chips/collide-1..2.mp3` (from `chips-collide-1/2.ogg`),
  `audio/chips/handle-1..2.mp3` (from `chips-handle-1/2.ogg`)
- Original title: Casino Audio (version 1.1)
- Creator: Kenney Vleugels (Kenney.nl)
- Source / original URL: https://kenney.nl/assets/casino-audio
  (downloaded 2026-07-20)
- License: Creative Commons Zero (CC0),
  http://creativecommons.org/publicdomain/zero/1.0/
- Modifications: converted OGG → mono MP3, peak-normalized, leading
  silence trimmed, files renamed.

### Interface sound effects from Kenney's "Interface Sounds" pack

- Files: `audio/ui/click-1..3.mp3` (from `click_002/003/004.ogg`),
  `audio/ui/toggle-1..2.mp3` (from `switch_004/005.ogg`),
  `audio/ui/open.mp3` (from `select_005.ogg`),
  `audio/ui/close.mp3` (from `close_002.ogg`)
- Original title: Interface Sounds
- Creator: Kenney Vleugels (Kenney.nl)
- Source / original URL: https://kenney.nl/assets/interface-sounds
  (downloaded 2026-07-20)
- License: Creative Commons Zero (CC0),
  http://creativecommons.org/publicdomain/zero/1.0/
- Modifications: converted OGG → mono MP3, peak-normalized, leading
  silence trimmed, files renamed.

### Synthesized result and feedback sounds (original works)

- Files: `audio/results/win.mp3`, `audio/results/blackjack.mp3`,
  `audio/results/push.mp3`, `audio/results/loss.mp3`,
  `audio/results/bust-1..2.mp3`, `audio/results/knock.mp3`,
  `audio/ui/invalid.mp3`, `audio/ui/scan-success.mp3`
- Creator: generated locally for this project (procedural synthesis:
  felt-mallet/celesta partials, band-limited noise bursts; NumPy script,
  rendered to WAV, encoded to MP3 with ffmpeg).
- Source: original to this repository; no third-party recording used.
- License: same terms as the project; no external license applies.
- Design intent: an elegant, restrained result hierarchy (blackjack >
  win > push > loss), deliberately avoiding slot-machine or arcade
  celebration.
- `ui/scan-success.mp3` confirms an imported pairing QR code in local
  multiplayer. It is the positive counterpart of `ui/invalid.mp3` and
  belongs to the interface family rather than the result family: a
  single short A5 → D6 mallet gesture (the same D major the win and
  blackjack sounds are built on) with an F#6 sparkle and a brief
  band-limited noise strike, 0.60 s, mono, peak-normalized to −3 dBFS.

### Casino-room ambience

The ambience layer is fully procedural at runtime
(`src/js/audio/ambience.js`): a synthesized low-passed noise "room
presence" bed plus sparse, heavily filtered distant one-shots reusing
the CC0 chip/card recordings above. No dedicated ambience recording is
shipped, so no additional license is involved.

## Textures

All felt, wood grain, leather, and paper textures used by the
"Salon privé" theme are generated locally with inline SVG
(`feTurbulence`) data URIs and CSS gradients inside
`src/styles/theme-salon.css`. There are no downloaded texture images and
therefore no third-party licenses involved.
