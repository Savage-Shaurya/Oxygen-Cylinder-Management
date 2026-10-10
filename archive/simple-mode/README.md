# Archived: Simple mode, Hindi/English text and Sarvam voice

Rolled back on 11 October 2026 at the owner's request. Everyone now uses the office screens.
Nothing here is built, type-checked or tested; it is kept so it can be brought back.

| Folder | What it was |
|---|---|
| `src/basic/` | Picture-based Simple mode: Give, Take back, My truck, Scan, Problem, Came back, Load truck, Filled, Check; the 5-second undo, dots, tick/cross, animations (Anime.js) |
| `src/i18n/` | Hindi and English text for Simple mode |
| `public/voice/` | 160 Sarvam recordings (Hindi + English) and their manifest |
| `scripts/voice-clips.ts` | Records the clips with Sarvam (needs `SARVAM_API_KEY`) |
| `server/voice.ts`, `shared/voice.ts` | The `/api/voice` live speech endpoint and shared voice settings |
| `tests/` | The tests for all of the above |

The complete working version, exactly as it was before the rollback, is the Git branch
`archive/simple-mode-voice` (commit 902998d). To bring it back:

```sh
git checkout archive/simple-mode-voice -- src/basic src/i18n public/voice scripts/voice-clips.ts server/voice.ts shared/voice.ts
```

Then restore the hand-off in `src/App.tsx`, the `/api/voice` route in `server/http-app.ts`,
the voice options in `server/app.ts` and `server/vercel.ts`, and the `animejs` and
`@fontsource/noto-sans*` packages. Comparing with that branch shows each line.
