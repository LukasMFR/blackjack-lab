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
  https://openfontlicense.org — free for commercial use, embedding, and
  redistribution with software.
- Usage: display face for the "Salon privé" visual theme only (headings,
  table message, bankroll figures). Declared with `font-display: swap`;
  browsers download it only when the theme actually uses it.
- Size: ~23 KB total (two woff2 subsets: latin + latin-ext, covering
  English and French including œ/Œ).

## Textures

All felt, wood grain, leather, and paper textures used by the
"Salon privé" theme are generated locally with inline SVG
(`feTurbulence`) data URIs and CSS gradients inside
`src/styles/theme-salon.css`. There are no downloaded texture images and
therefore no third-party licenses involved.
