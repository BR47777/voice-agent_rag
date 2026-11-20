# Krisp Voice Lab

A React demo that streams microphone audio through Krisp's Voice Isolation
WebSocket API and plays back the cleaned output. The browser connects to a
local backend proxy; the master API key stays on the backend, which creates a
short-lived session token for each Krisp connection.

## Run

```bash
npm install
npm run proxy
```

Copy `.env.example` to `.env.local` and set your API key there:

```dotenv
KRISP_API_KEY=your_api_key_here
```

In a second terminal, start the React app:

```bash
npm run dev
```

Open the local URL printed by Vite and allow microphone access. Use headphones
to avoid speaker output feeding back into the microphone.

## Audio protocol

The browser converts microphone audio to mono 16 kHz, signed 16-bit PCM and
sends exactly 30 ms (960-byte) frames. The backend obtains a five-minute
`viva` session token using `KRISP_API_KEY`, connects to
`wss://streaming.krisp.ai/voice-isolation`, and relays the audio and cleaned
frames. The selected suppression level is sent when the session starts.

The master API key is never sent to the browser or Krisp's WebSocket. The
backend listens on `127.0.0.1` by default and only accepts the local Vite
origins. For deployment, add application authentication, origin restrictions,
rate limits, and TLS before exposing a proxy publicly.

See the Krisp docs for [Voice Isolation](https://developers-docs.krisp.ai/docs/realtime-voice-isolation)
and [session-token authentication](https://developers-docs.krisp.ai/docs/authentication).
