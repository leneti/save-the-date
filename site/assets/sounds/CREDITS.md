# Sounds: credits

All sources are CC0 (public domain dedication). No Pixabay, CC-BY or unknown-licence material.

| File | Source | Author | Licence | Processing |
|---|---|---|---|---|
| tick.mp3 | Kenney "Interface Sounds" `click_001.ogg` (https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 | Trimmed to 75 ms, 20 ms fade-out, peak normalised to -3 dBFS, mono, MP3 96 kbps |
| shutter.mp3 | Kenney "Interface Sounds" `click_003.ogg` at 0 ms, mixed with `switch_001.ogg` (first 200 ms, 0.8 gain) at 55 ms (https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 | Layered two-stage click to imitate shutter open/close, trimmed to 280 ms, 50 ms fade-out, peak -3 dBFS, mono, MP3 96 kbps |
| clunk.mp3 | Kenney "Impact Sounds" `impactSoft_heavy_000.ogg` (https://kenney.nl/assets/impact-sounds) | Kenney (kenney.nl) | CC0 1.0 | Trimmed to 340 ms, 100 ms fade-out, peak -3 dBFS, mono, MP3 96 kbps |
| whirr.mp3 | **Synthesised** (Node script, no external samples) | Generated for this project | CC0 (own work, dedicated to the public domain) | 800 ms: ~95 Hz motor tone with harmonics, 30 Hz amplitude modulation, band-limited gear/air noise. Every component is an exact integer multiple of 1/0.8 s, so the waveform is exactly periodic; start point rotated to a rising zero crossing. Level matched by RMS to the other sounds (peak about -10 dBFS), mono, MP3 96 kbps |

Kenney licence text: "License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/". Crediting Kenney is optional.

Looping note: each MP3 starts with an Info/LAME header frame holding the encoder delay and padding, so decoders that honour it (Chromium, Firefox, Safari) give exact lengths. With it, `whirr.mp3` decodes to exactly 800 ms and the end sample (-0.011) joins the first sample (+0.012) with no click when looped via Web Audio (`source.loop = true`).
