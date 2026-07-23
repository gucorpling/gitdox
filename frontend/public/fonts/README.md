# Embedded Fonts

Use this directory for custom web fonts that are not guaranteed to exist on all systems.

## Canonical Location

- Put font files under this folder, for example:
  - `public/fonts/antinoou-webfont.woff`
  - `public/fonts/antinoou-webfont.ttf`
  - `public/fonts/antinoou/Antinoou.woff2`
  - `public/fonts/antinoou/Antinoou.woff`
  - `public/fonts/antinoou/Antinoou.ttf`
  - `public/fonts/antinoou/Antinoou.eot`

## Supported Formats

- `woff2`
- `woff`
- `ttf` (`truetype`)
- `otf` (`opentype`)
- `eot` (`embedded-opentype`)

## Config Example

Define embedded fonts in `gitdox-config.yaml` under `ui.embedded_fonts`:

```yaml
ui:
  font: "Antinoou"
  embedded_fonts:
    - family: "Antinoou"
      style: normal
      weight: "400"
      display: swap
      sources:
        - path: "/fonts/antinoou/Antinoou.woff2"
          format: "woff2"
        - path: "/fonts/antinoou/Antinoou.woff"
          format: "woff"
        - path: "/fonts/antinoou/Antinoou.ttf"
          format: "truetype"
```

Notes:
- Paths are served from Vite `public/`, so use root-relative URLs like `/fonts/...`.
- Path must match the actual file location exactly. Example: `public/fonts/antinoou-webfont.woff` must be configured as `/fonts/antinoou-webfont.woff`.
- Keep `ui.font` aligned with the `family` name so it works as global fallback.
- Editor-specific keys (`xml.font`, `entities.font`, `spreadsheet.font`) override `ui.font`.
