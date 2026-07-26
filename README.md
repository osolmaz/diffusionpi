# diffusionpi

Watch a diffusion LLM denoise its answer live in the terminal. diffusionpi
runs [Pi](https://github.com/earendil-works/pi) against a local vLLM serving
DiffusionGemma and renders the model's real intermediate canvas above the
editor: instead of text appearing in silent bursts, you see accepted tokens
and renoise tokens converge into the final text on every denoising step.

No forked Pi involved: this is a declarative
[pi-factory](https://github.com/dutifuldev/pi-factory) app bundle plus two
ordinary Pi extensions.

```
bin/diffusionpi                 launcher (pi-factory wrapper)
app/                            pi-factory app bundle
  pi-factory.toml               interactive session
  demo.pi-factory.toml          self-driving demo (no tools, auto prompts)
  extensions/demo-mode.ts       demo driver + minimal demo chrome
  extensions/smooth-scroll.ts   gradual viewport scroll (Pi internals hack)
  prompts/                      demo prompts
packages/diffusion-canvas/      the canvas widget (standalone Pi package)
docs/diffusion-canvas-repro.md  full reproduction guide
```

## Requirements

- Node 20+ and npm (Pi and pi-factory are fetched via `npx`).
- A vLLM server with the diffusion canvas side channel. The changes are pure
  Python, so they overlay the official precompiled kernels:

  ```bash
  VLLM_USE_PRECOMPILED=1 \
  VLLM_PRECOMPILED_WHEEL_COMMIT=4e5ca89cfe98121642d76b40e32a006f4d0fbf3b \
  pip install git+https://github.com/osolmaz/vllm@canvas-v0.23.1rc4
  ```

## Run

Serve DiffusionGemma with canvas streaming:

```bash
vllm serve nvidia/diffusiongemma-26B-A4B-it-NVFP4 \
  --host 127.0.0.1 --port 8000 \
  --max-model-len 32768 --max-num-seqs 16 --max-num-batched-tokens 8192 \
  --kv-cache-dtype fp8 \
  --enable-auto-tool-choice --tool-call-parser gemma4 \
  --diffusion-stream-canvas
```

Then:

```bash
bin/diffusionpi         # interactive session with the canvas
bin/diffusionpi demo    # self-driving story demo (for recordings)
bin/diffusionpi plan    # print the launch plan without running
```

The launcher turns the bundle in `app/` into a Pi launch: provider `vllm` at
`http://127.0.0.1:8000/v1`, model `nvidia/diffusiongemma-26B-A4B-it-NVFP4`,
and the two extensions. Edit `app/pi-factory.toml` if your server or model id
differ.

The canvas widget needs no configuration: it derives the events and metrics
URLs from the active model's `baseUrl`, with `PI_DIFFUSION_CANVAS_EVENTS_URL`
and `PI_DIFFUSION_CANVAS_METRICS_URL` as overrides. Against a server without
the side channel it falls back to a clearly labeled simulation paced by the
real commit bursts.

## Demo grid and recording

A wall of concurrent diffusionpi sessions (and an mp4 of it) is orchestrated
by [localpi](https://github.com/osolmaz/localpi), which provides the generic
tmux grid and Ghostty recording tooling. Put `bin/diffusionpi` on your PATH
(for example `ln -s "$PWD/bin/diffusionpi" ~/.local/bin/diffusionpi`), then:

```bash
# 2x2 wall of self-driving demo sessions:
localpi grid --concurrency 4 --start -- diffusionpi demo

# Record the wall to an mp4 in a Catppuccin-themed Ghostty window:
localpi record --session pi-demo-<timestamp> --out demo.mp4 --seconds 60
```

Concurrency above 4 needs `--allow-high-concurrency` and should match the
vLLM server's `--max-num-seqs`. See the localpi README for the full set of
grid and record options.

## Smooth scroll

Stock Pi appends a whole diffusion commit (~15+ lines) to the chat in one
frame, which makes the viewport jump. The bundled `smooth-scroll` extension
fixes this with a deliberate hack: it grabs the live TUI instance and wraps
the chat container's `render()` so appended lines are revealed at a bounded
rate (default 40 lines/s) instead of all at once. Real content, paced only at
the render layer.

Because it reaches into Pi internals, it is version-sensitive: it checks that
the component tree looks like Pi 0.8x and silently no-ops otherwise, so a Pi
upgrade degrades to the stock jumpy behavior rather than breaking.

- `DIFFUSIONPI_SMOOTH_SCROLL=0` disables it
- `DIFFUSIONPI_SCROLL_SPEED=<lines/s>` changes the reveal rate
- `DIFFUSIONPI_SCROLL_DEBUG=<path>` logs per-frame pacing decisions

Independently, you can also make the commits themselves smaller and more
frequent server-side:

```bash
vllm serve ... --diffusion-config '{"canvas_length": 64}'
```

Smaller canvases trade some throughput for gentler commits.

You can also use the widget with any Pi setup, no bundle needed:

```bash
pi install ./diffusionpi/packages/diffusion-canvas
```

See [docs/diffusion-canvas-repro.md](docs/diffusion-canvas-repro.md) for the
full reproduction guide, including how the truthful streaming path works and
how the vLLM fork is maintained.

## License

[MIT](LICENSE)
