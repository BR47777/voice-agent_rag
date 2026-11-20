# Krisp Voice Lab

A React demo for comparing original microphone audio with Krisp JavaScript SDK
noise cancellation.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite and allow microphone access.

## Add the Krisp JS SDK

Copy the downloaded Krisp JavaScript SDK `dist` directory to:

```text
public/krisp/
```

The demo expects:

```text
public/krisp/krispsdk.mjs
public/krisp/models/model_8.kef
public/krisp/models/model_nc.kef
```

To use custom paths, copy `.env.example` to `.env.local` and update the
`VITE_KRISP_*` values.

Without SDK and model files, the demo runs in preview mode and passes through
the original microphone stream.
