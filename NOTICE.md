# Notices

digi-pet's own code is MIT licensed (see `LICENSE`). Some files in this
repository hold material that is not, listed below. That material is not
covered by the MIT license and is not offered under any license by this
project.

## Digimon artwork and names

Digimon, Digital Monster and every Digimon name and sprite are trademarks and
copyrights of Bandai / Bandai Namco and Toei Animation. digi-pet is an
unofficial fan project, not affiliated with or endorsed by them.

- `plugin/hooks/sprites.gen.ts` holds Digimon sprites as pixel grids:
  - idle frames from the Digital Monster Color, as hosted by Digitama Hatchery
    (https://humulos.com/digimon/dmc/);
  - twelve-pose sheets from the community "Full Color Digimon Dot Sprites"
    pack (https://withthewill.net/threads/full-color-digimon-dot-sprites.25843/),
    compiled and coloured by Tortoiseshel, with some fan-made frames as the
    pack notes.

  The source of every sprite is listed in `sprites/CREDITS.md`. They are
  included for personal, non-commercial use. If you are a rights holder and
  want them removed, open an issue and they will be taken down.

## Evolution chart data

`data/dmc.json`, and `plugin/hooks/species.gen.ts` generated from it, hold the
Digital Monster Color evolution charts and requirements as documented by
Digitama Hatchery (https://humulos.com/digimon/dmc/). Credit for compiling
that information goes to its authors.

The scripts in `scripts/` rebuild both from those sources:
`crawl-humulos.ts`, `fetch-sheets.ts`, `build-sprites.ts`, `build-species.ts`.

## Code from hoobnn-agent-mods

`plugin/hooks/cells.ts` is copied from, and `plugin/hooks/activity.ts` is
adapted from, hoobnn's spinner mod
(https://github.com/hoobnn/hoobnn-agent-mods, `claude-code/spinner/hooks/`),
under this license:

```
MIT License

Copyright (c) 2026 hoobnn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
