# Voice Agent RAG

A practical reference for designing voice agents that combine
retrieval-augmented generation (RAG) with speech-to-text (STT), turn detection,
text-to-speech (TTS), and interruption handling.

This repository currently contains a documentation-first example of one voice
call. It is intended to explain the architecture and failure modes before an
implementation is added.

## Contents

- [Overview](#overview)
- [Setup](#setup)
- [React Demo](#react-demo)
- [Programmatic SDK and Model Downloads](#programmatic-sdk-and-model-downloads)
- [Krisp Models](#krisp-models)
- [VIVA Voice Isolation Quickstart](#viva-voice-isolation-quickstart)
- [Pipecat with VIVA](#pipecat-with-viva)
- [Calls and Apps with the Krisp JS SDK](#calls-and-apps-with-the-krisp-js-sdk)
- [Core Architecture](#core-architecture)
- [End-to-End Latency](#end-to-end-latency)
- [Example Call](#example-call)
- [Handling Background Speech](#handling-background-speech)
- [Chain or Speech-to-Speech](#chain-or-speech-to-speech)
- [Containment and Escalation](#containment-and-escalation)
- [Testing a Voice Agent](#testing-a-voice-agent)
- [Key Takeaway](#key-takeaway)

## Overview

A text agent and a voice agent both reason about language and use tools, but
they accept and return different media:

| Text agent | Voice agent |
|---|---|
| User presses Enter to end a message | Turn detection determines when speech ends |
| Receives text | Receives audio through STT |
| Sends text | Sends text through TTS |
| Keeps chat history | Keeps call history |

A voice agent can be thought of as a text agent plus three voice components:

1. **Speech-to-text (STT)** converts caller audio into words.
2. **Turn detection** decides when the caller has finished and when to resume or
   stop the agent.
3. **Text-to-speech (TTS)** converts the generated response into audio.

The LLM remains in the middle: it receives a transcript, maintains context,
decides whether to answer, and calls tools when needed.

```text
caller audio
    -> STT
    -> turn detection
    -> LLM / RAG / tools
    -> TTS
    -> agent audio
```

## Setup

This repository contains Markdown only, so no application dependencies or
runtime services are required to read or edit the guide.

### Prerequisites

- Git
- A Markdown viewer or editor

### Clone the repository

```bash
git clone https://github.com/BR47777/voice-agent_rag.git
cd voice-agent_rag
```

Open `README.md` in a Markdown editor or use GitHub's README preview.

### Repository status

The repository does not yet include a runnable voice-agent implementation,
configuration files, or test audio. As code is added, document provider setup,
environment variables, installation commands, startup commands, and tests here.

## React Demo

A browser demo is available in [`react-demo/`](./react-demo).

```bash
cd react-demo
npm install
npm run dev
```

Place the downloaded Krisp JS SDK and model files in
`react-demo/public/krisp/`, then allow microphone access in the browser.

## Programmatic SDK and Model Downloads

The Developers Portal API can return temporary download URLs for a specific
SDK version and the model files associated with it. It is suitable for CI/CD,
automated testing, and deployment scripts.

**Host:** `https://api.developers.krisp.ai/`

### Download URLs

```text
GET /v2/sdk/versions/{id}/download-urls
```

`id` is the numeric SDK version ID shown in your SDK dashboard.

```bash
curl --location \
  "https://api.developers.krisp.ai/v2/sdk/versions/329/download-urls" \
  --header "Authorization: api-key ${KRISP_DEVELOPER_API_KEY}"
```

The API key header uses the format `api-key YOUR_API_KEY`. Do not commit the
key or expose it in browser or client-side code.

The response contains:

- `expires_in`: URL lifetime, usually 300 seconds
- `version.download_url`: SDK package URL
- `models[].download_url`: model package URLs
- Package and model metadata such as filename, technology, and platform

Example response:

```json
{
  "success": true,
  "data": {
    "expires_in": 300,
    "version": {
      "id": 42,
      "version": "1.3.4",
      "display_name": "VIVA",
      "os": "windows_x64",
      "platform": "server",
      "technologies": ["viva"],
      "filename": "release.zip",
      "download_url": "https://s3.amazonaws.com/example-release.zip"
    },
    "models": [
      {
        "id": 1,
        "technology": "voice_isolation",
        "product": "viva",
        "filename": "model.zip",
        "download_url": "https://s3.amazonaws.com/example-model.zip"
      }
    ]
  }
}
```

Download URLs are short-lived. Download and verify packages immediately rather
than storing the URLs for later use.

## Krisp Models

Krisp models are loaded in two main ways:

- Krisp API models are selected in the client `model` field.
- VIVA and RTC SDK models are downloaded and loaded from model files.

### Krisp API

| Model ID | Endpoint | Use |
|---|---|---|
| `VIVA-tel` | `/voice-isolation` | Voice Isolation for telephony audio at 8 or 16 kHz |
| No model field | `/vt` | Voice Translation; select languages and voice in the request |

### VIVA SDK

Download VIVA models from the Developers Portal and load them as `.kef` files.

| Model | Feature | Use |
|---|---|---|
| `krisp-viva-vi-tel-v2.5.1` | Voice Isolation | Telephony, 8-16 kHz; best noise cancellation |
| `krisp-viva-vi-tel-lite-v2.5` | Voice Isolation | Telephony, 8-16 kHz; lowest CPU usage |
| `krisp-viva-vi-tel-v2.7` | Voice Isolation | Telephony, 8-16 kHz; most ASR-friendly |
| `krisp-viva-vi-pro-v1` | Voice Isolation | WebRTC audio above 16 kHz |
| `krisp-viva-nc-ss-v1` | Noise cancellation | Smart-speaker and far-field audio; does not remove background voices |
| `krisp-viva-tp-v3` | Turn-Taking | End-of-turn prediction across languages |
| `krisp-viva-ip-v1.1` | Interrupt Prediction | Distinguishes interruptions from backchannels |
| `krisp-viva-vad-v2` | VAD | Voice activity detection |

Model families and recommended versions can change. Download and verify the
versions supported by your SDK package.

### RTC SDK

RTC SDK model names follow
`krisp-<technology>-<stream>-<size>-v<version>`. Here, `nc` means noise
cancellation and `bvc` means background voice cancellation; `o` is outbound
microphone audio and `i` is inbound speaker audio.

| Model | Stream | Use |
|---|---|---|
| `krisp-nc-o-pro-v1` | Outbound | 32 kHz, high-quality noise cancellation |
| `krisp-nc-o-med-v7` | Outbound | Mobile and power-limited devices |
| `krisp-nc-o-lite-v1` | Outbound | 16 kHz, lowest CPU |
| `krisp-nc-o-nb-v2` | Outbound | Narrow-band audio up to 8 kHz |
| `krisp-bvc-o-pro-v3` | Outbound | Background voice cancellation |
| `krisp-bvc-o-lite-v2` | Outbound | Lower-complexity background voice cancellation |
| `krisp-nc-i-wb-pro-v3` | Inbound | Wide-band inbound noise cancellation |
| `krisp-nc-i-nb-pro-v1` | Inbound | Narrow-band inbound noise cancellation |
| `krisp-nc-i-nb-lite-v2` | Inbound | Lower-complexity narrow-band inbound noise cancellation |

Large RTC models such as `krisp-nc-o-max-v1` and `krisp-bvc-o-max-v3` are
available for evaluation on request.

## VIVA Voice Isolation Quickstart

This example installs the VIVA SDK for Python and runs Krisp's Voice Isolation
model against a WAV file. The model removes background voices and noise and
writes a cleaned file for playback.

The VIVA SDK runs on your own servers on CPU. Audio never leaves your machine.
It is also available for Node.js, Go, Rust, C++, and C.

### Requirements

- Linux (x64 or armv8a), Windows (x64 or armv8a), or macOS (x64 or armv8a).
- Python 3.10 or later.
- NumPy.
- A 16 kHz, mono, 16-bit PCM WAV file.

Convert an existing audio file with [FFmpeg](https://ffmpeg.org/):

```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -sample_fmt s16 noisy.wav
```

### Download the SDK and model

The VIVA SDK is available on request. In the
[Krisp Developers Portal](https://developers.krisp.ai/), open **Voice
Isolation**, select **Request access**, and provide the platforms and expected
volume. Once access is granted, download the latest **VIVA SDK for Python**
wheel from **Voice Isolation > Downloads**.

The package includes the models for current SDK versions. Older SDK versions
may require downloading the model package separately.

This quickstart uses
`krisp-viva-vi-tel-v2.5.1.kef`, a Voice Isolation model intended for 8-16 kHz
audio. See Krisp's model documentation for alternatives.

If you only want to try Voice Isolation without self-hosting the SDK, the
Krisp Voice Isolation API is available through the Developers Portal.

### Install and configure access

The package provides one wheel per Python version:

- Python 3.10: `cp310`
- Python 3.11: `cp311`
- Python 3.12 and later: `cp312-abi3`
- Free-threaded Python 3.14: `cp314-cp314t`

Create a virtual environment and install NumPy and the matching Krisp wheel:

```bash
python -m venv .venv
source .venv/bin/activate
pip install numpy /path/to/krisp-viva-python-sdk.whl
```

On Windows, activate the environment with:

```powershell
.venv\Scripts\Activate.ps1
```

The usage-reporting (UAR) build needs an API key. Set it and pass it to
`globalInit` through the environment:

```bash
export KRISP_VIVA_API_KEY="your-api-key"
```

The SDK does not read environment variables itself. The standard
`krisp-viva-python-sdk` build does not require a key.

### Create the script

Save the following as `clean.py`. It reads the WAV file in 10 ms frames, runs
each frame through Voice Isolation, and writes the cleaned audio.

```python
import os
import sys
import wave

import numpy as np
import krisp_audio

SAMPLE_RATE = 16000
FRAME_SIZE = SAMPLE_RATE // 100  # 10 ms


def log_callback(log_message, log_level):
    print(f"[{log_level}] {log_message}", flush=True)


def main(model_path: str, in_path: str, out_path: str) -> None:
    api_key = os.environ.get("KRISP_VIVA_API_KEY")

    if api_key:
        # Usage-reporting (UAR) build
        krisp_audio.globalInit(
            "",
            api_key,
            None,
            log_callback,
            krisp_audio.LogLevel.Off,
        )
    else:
        # Standard build
        krisp_audio.globalInit(
            "",
            log_callback,
            krisp_audio.LogLevel.Off,
        )

    model_info = krisp_audio.ModelInfo()
    model_info.path = model_path

    nc_cfg = krisp_audio.NcSessionConfig()
    nc_cfg.inputSampleRate = krisp_audio.SamplingRate.Sr16000Hz
    nc_cfg.inputFrameDuration = krisp_audio.FrameDuration.Fd10ms
    nc_cfg.outputSampleRate = krisp_audio.SamplingRate.Sr16000Hz
    nc_cfg.modelInfo = model_info

    session = krisp_audio.NcFloat.create(nc_cfg)

    with wave.open(in_path, "rb") as wav:
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)

    audio = pcm.astype(np.float32) / 32768.0
    frame_count = len(audio) // FRAME_SIZE
    cleaned = []

    for i in range(frame_count):
        frame = audio[i * FRAME_SIZE:(i + 1) * FRAME_SIZE]
        cleaned.append(session.process(frame, 100.0))

    output = np.clip(
        np.concatenate(cleaned) * 32768.0,
        -32768,
        32767,
    ).astype(np.int16)

    with wave.open(out_path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(output.tobytes())

    session = None
    krisp_audio.globalDestroy()

    print(
        f"Processed {frame_count} frames "
        f"({frame_count / 100:.1f} s) -> {out_path}"
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
```

`NcFloat.process` accepts a one-dimensional `float32` NumPy array and returns
a cleaned array of the same length. Its second argument is the suppression
level, from `0` to `100`; `100` is the default behavior used here.

### Run it

```bash
python clean.py \
  /path/to/models/krisp-viva-vi-tel-v2.5.1.kef \
  noisy.wav \
  clean.wav
```

For a 12-second WAV file, the script reports:

```text
Processed 1200 frames (12.0 s) -> clean.wav
```

Play `noisy.wav` and `clean.wav` to compare them. Voice Isolation should remove
background voices and noise while preserving the main speaker.

## Pipecat with VIVA

Pipecat provides native Krisp VIVA integration. A bot can use two components:

- **`KrispVivaFilter`** applies
  [Voice Isolation](https://developers-docs.krisp.ai/docs/voice-isolation) to
  incoming transport audio before VAD, turn detection, and speech-to-text.
- **`KrispVivaTurn`** applies
  [Turn-Taking](https://developers-docs.krisp.ai/docs/turn-taking) as the user
  turn-stop strategy, replacing Pipecat's default strategy.

The components can be used independently, but Turn-Taking performs best on
audio that has already passed through Voice Isolation.

> This guide supersedes the Krisp guide previously published at
> `docs.pipecat.ai/guides/features/krisp-viva`.

### Prerequisites

- A working Pipecat bot based on Pipecat's sample `bot.py`.
- The `uv` package manager.
- A Krisp Developers Portal account with VIVA SDK access.
- A VIVA SDK API key.

### Install

1. Download the latest VIVA SDK for Python wheel and the VIVA models from the
   [Developers Portal](https://developers.krisp.ai/), then unzip the models.
2. Install the wheel in the same virtual environment as Pipecat:

   ```bash
   uv pip install /path/to/krisp-viva-python-sdk.whl
   ```

3. Add the API key and model paths to `.env`:

   ```dotenv
   # Required for SDK v1.6.1 and later
   KRISP_VIVA_API_KEY=your_api_key_here

   # Voice Isolation model
   KRISP_VIVA_FILTER_MODEL_PATH=/path/to/models/krisp-viva-vi-tel-v2.5.1.kef

   # Turn-Taking model
   KRISP_VIVA_TURN_MODEL_PATH=/path/to/models/krisp-viva-tp-v3.kef
   ```

### Add Voice Isolation

Import the filter:

```python
from pipecat.audio.filters.krisp_viva_filter import KrispVivaFilter
```

Set `KrispVivaFilter()` as `audio_in_filter` on each transport that should
isolate caller audio. For example:

```python
async def bot(runner_args: RunnerArguments):
    """Main bot entry point for the bot starter."""
    transport_params = {
        "daily": lambda: DailyParams(
            audio_in_filter=KrispVivaFilter(),
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
        "webrtc": lambda: TransportParams(
            audio_in_filter=KrispVivaFilter(),
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }
    transport = await create_transport(runner_args, transport_params)
```

Configure it on every transport the bot actually uses.

### Add Turn-Taking

Import Krisp Turn-Taking and Pipecat's turn strategy classes:

```python
from pipecat.audio.turn.krisp_viva_turn import KrispVivaTurn
from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
```

A typical context aggregator keeps a VAD analyzer:

```python
context = LLMContext()
user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
    context,
    user_params=LLMUserAggregatorParams(
        vad_analyzer=SileroVADAnalyzer(),
    ),
)
```

Add `user_turn_strategies` to the user parameters and keep the VAD analyzer:

```python
context = LLMContext()
user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
    context,
    user_params=LLMUserAggregatorParams(
        user_turn_strategies=UserTurnStrategies(
            stop=[
                TurnAnalyzerUserTurnStopStrategy(
                    turn_analyzer=KrispVivaTurn(),
                )
            ]
        ),
        vad_analyzer=SileroVADAnalyzer(),
    ),
)
```

Krisp Turn-Taking uses Pipecat's VAD decisions, so removing
`SileroVADAnalyzer()` is not recommended.

### Troubleshooting

- **The filter or turn strategy fails to load:** Verify that the Krisp wheel is
  installed in Pipecat's virtual environment, `KRISP_VIVA_API_KEY` is set for
  SDK v1.6.1 or later, and the model paths point to the unzipped `.kef` files.
- **The bot reacts to background speakers:** Confirm that
  `KrispVivaFilter()` is configured on the caller's active transport.
- **The bot interrupts users or answers late:** Adjust the Turn-Taking
  thresholds and test them with recorded pauses and background voices.

## Calls and Apps with the Krisp JS SDK

The Krisp JavaScript SDK adds noise cancellation to web-based and desktop
communication applications. It can process audio streams in supported call and
meeting platforms, helping remove background noise and improve speech clarity.

Integration guides are available for:

| Platform | Integration |
|---|---|
| [Twilio Voice](https://developers-docs.krisp.ai/docs/twilio-voice) | Use Krisp with the Twilio JS Voice SDK Audio Processor API |
| [Amazon Connect](https://developers-docs.krisp.ai/docs/amazon-connect) | Add noise cancellation to a cloud contact-center experience |
| [Jitsi Meet](https://developers-docs.krisp.ai/docs/jitsi) | Integrate Krisp with a self-hosted Jitsi application |
| [SIP.js](https://developers-docs.krisp.ai/docs/js-integrations) | Add Krisp processing to SIP endpoints |
| [React](https://developers-docs.krisp.ai/docs/react) | Integrate the JS SDK into a React application |
| [Electron](https://developers-docs.krisp.ai/docs/electron) | Add noise-free communication to a cross-platform desktop app |

Examples for additional frameworks are available on request. WebRTC
integration for desktop is not currently documented here; Krisp WebRTC support
is presently available for mobile platforms.

### Twilio Voice Audio Processor

Twilio Voice JS SDK's `AudioProcessor` API exposes raw microphone input and
allows an application to transform it before Twilio encodes and sends the
audio.

The Krisp SDK sits in that pipeline between the microphone and audio encoder.
It creates a processed `MediaStream` that removes unwanted noise before the
Twilio call transmits it.

Load the Krisp and Twilio SDK modules:

```javascript
import { AudioProcessor, Device } from "@twilio/voice-sdk";
import KrispSDK from "/noisecancellation/krisp/latest.js.version/dist/krispsdk.mjs";
```

Implement the Twilio audio processor interface. Host the Krisp SDK models in
the application and download matching model files from the Krisp Developers
Portal.

```javascript
let audioContext = null;

class NoiseCancellationAudioProcessor implements AudioProcessor {
  constructor() {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
  }

  async init() {
    this.krispSDK = new KrispSDK({
      params: {
        models: {
          modelBVC:
            "/noisecancellation/krisp/latest.js.version/dist/models/model_bvc.kef",
          model8:
            "/noisecancellation/krisp/latest.js.version/dist/models/model_8.kef",
          modelNC:
            "/noisecancellation/krisp/latest.js.version/dist/models/model_nc.kef",
        },
      },
    });
    await this.krispSDK.init();
  }

  async createProcessedStream(stream) {
    if (!this.krispSDK) {
      await this.init();
    }

    this.filterNode = await this.krispSDK.createNoiseFilter(
      { audioContext, stream },
      () => {
        this.filterNode.enable();
      },
    );

    this.source = audioContext.createMediaStreamSource(stream);
    this.destination = audioContext.createMediaStreamDestination();

    this.source.connect(this.filterNode);
    this.filterNode.connect(this.destination);

    return this.destination.stream;
  }

  async destroyProcessedStream() {
    if (this.source) {
      this.source.disconnect();
    }
    if (this.destination) {
      this.destination.disconnect();
    }
    if (this.filterNode) {
      this.filterNode.disconnect();
      await this.filterNode.dispose();
    }

    this.source = null;
    this.destination = null;
    this.filterNode = null;
  }
}
```

Construct the Twilio device, processor, and register the processor:

```javascript
const device = new Device(token, options);
const processor = new NoiseCancellationAudioProcessor();

await device.audio.addProcessor(processor);

// Remove noise cancellation later:
// await device.audio.removeProcessor(processor);
```

Keep these lifecycle concerns in mind:

- Initialize Krisp only once and reuse the processor for the device when
  practical.
- Disconnect and dispose the AudioWorklet node before destroying a call stream.
- Serve the SDK module and model files with your application.
- Test in the browser where the call runs; browser audio permissions, secure
  contexts, and browser support can affect initialization.

### React

The Krisp JavaScript SDK can be initialized in a React app and connected to
the browser's `MediaStream` through an `AudioContext`.

Create a new app with Create React App, or skip this step in an existing React
project:

```bash
npx create-react-app my-app
cd my-app
```

Copy the Krisp SDK `dist` directory into the project and serve its JavaScript,
worker, and model files from the same application.

```javascript
import KrispSDK from "./dist/krispsdk";
```

For TypeScript, import the filter node type when needed:

```typescript
import KrispSDK, { IAudioFilterNode } from "./dist/krispsdk";
```

Track lifecycle state and browser audio resources with React hooks:

```javascript
const [started, setStarted] = useState(false);
const [isReady, setIsReady] = useState(false);
const [isEnabled, setIsEnabled] = useState(null);

const audioElement = useRef();
const sdk = useRef();
const stream = useRef();
const filterNode = useRef();
const audioContext = useRef(new AudioContext());
const source = useRef();
const destination = useRef();
```

In TypeScript, the filter reference can use `IAudioFilterNode`:

```typescript
const filterNode = useRef<IAudioFilterNode>();
```

Initialize the SDK and create the noise-filter graph when the user starts
processing:

```javascript
const onStart = async () => {
  setStarted(true);

  sdk.current = new KrispSDK({
    params: {
      logProcessStats: false,
      debugLogs: false,
      models: {
        model8: "/dist/models/model_8.kef",
        modelNC: "/dist/models/model_nc.kef",
      },
      useSharedArrayBuffer: false,
    },
    callbacks: {
      errorCallback: () => {},
    },
  });

  stream.current = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  await audioContext.current.resume();
  sdk.current.init();

  filterNode.current = await sdk.current.createNoiseFilter(
    audioContext.current,
    () => setIsReady(true),
  );

  source.current = audioContext.current.createMediaStreamSource(
    stream.current,
  );
  destination.current =
    audioContext.current.createMediaStreamDestination();

  source.current.connect(filterNode.current);
  filterNode.current.connect(destination.current);

  if (audioElement.current) {
    audioElement.current.srcObject = destination.current.stream;
    await audioElement.current.play();
  }
};
```

Toggle the filter without replacing the audio graph:

```javascript
const onToggle = () => {
  if (filterNode.current?.isEnabled()) {
    filterNode.current.disable();
    setIsEnabled(false);
  } else {
    filterNode.current?.enable();
    setIsEnabled(true);
  }
};
```

Clean up the graph, media tracks, SDK, and UI state when stopping:

```javascript
const onDestroy = async () => {
  source.current?.disconnect();
  destination.current?.disconnect();
  stream.current?.getTracks().forEach((track) => track.stop());

  filterNode.current?.disconnect();
  await filterNode.current?.dispose();

  await audioContext.current?.suspend();
  sdk.current?.dispose();
  audioElement.current?.pause();

  setStarted(false);
  setIsEnabled(null);
};
```

Render the processed stream with an audio element:

```jsx
<audio
  ref={audioElement}
  id="audio"
  autoPlay
  controls
/>
```

## Core Architecture

### 1. Speech-to-text

STT streams partial transcripts as the caller speaks. Partial output lets a
turn detector reason about the words heard so far and lets the downstream
pipeline begin without waiting for the final transcript.

STT quality depends on microphone quality, competing speakers, room noise,
accents, domain vocabulary, and latency.

### 2. Turn detection

Voice agents use a combination of signals to decide whether the caller has
finished:

- **Voice activity detection (VAD)** detects speech and silence.
- **STT endpointing** uses speech recognition signals to detect an utterance
  end.
- **Turn detection models** assess transcript and intonation to distinguish a
  finished sentence from a natural pause.
- **Interruption handling** detects when a caller starts talking over the
  agent and stops or rewrites the current response.

These methods trade speed against accidental cutoffs. A short silence threshold
reduces wait time but may end the turn during a pause. A longer threshold can
cut a caller off less often, but makes every response slower.

### 3. LLM, RAG, and tools

The language model uses the current transcript and retrieved context to produce
a grounded answer. It may also call a tool, such as a calendar, inventory,
order, CRM, or knowledge-base service.

For example:

```text
Caller: Can I move my appointment to Thursday?

Retrieved context:
- Thursday has no availability
- Friday is available

LLM output:
- Ask whether Friday is acceptable
- Tool call: calendar.check(day="Friday")
```

The quality of the final response depends on the quality of everything before
it. A good prompt cannot repair words that STT mistranscribed or a turn that
ended too early.

### 4. Text-to-speech

TTS can stream the first audio sentence while the LLM continues generating the
rest of the answer. This overlap keeps users from waiting for a complete
response before hearing anything.

## End-to-End Latency

The STT, LLM, and TTS chain may overlap instead of running strictly one after
another.

Typical streamed component ranges include:

| Stage | Time to first useful output |
|---|---:|
| Network delivery | under 50 ms |
| STT partial transcript | 100-200 ms |
| LLM first token | 200-400 ms |
| TTS first audio | 100-300 ms |

With a turn-detection wait of roughly 300-500 ms, a caller may wait about
750-1,450 ms before the agent's first sound. Non-streamed chains can take 2-4
seconds per turn.

The best starting optimization is usually turn detection: a shorter, accurate
turn timeout removes an avoidable wait. Next, optimize the LLM's time to its
first token and the remaining handoffs.

## Example Call

```text
00:04.1  caller           "Can I move my appointment to"
00:04.6  turn detection   0.5 s of silence, turn ended
00:04.6  STT              "Can I move my appointment to"
00:04.7  caller           "Thursday, in the morning if you can"
00:05.0  LLM              "Sure, what day would you like?"
00:05.3  TTS              "Sure, what day would you like?"
00:06.2  STT              "Thursday in the morning if you can Friday at 9 works"
00:06.9  LLM              calendar.book(day="Friday", time="09:00")
```

This log demonstrates two failure modes:

- A half-second pause was interpreted as the end of the caller's sentence.
- Words spoken by a television entered the shared microphone and were included
  in the caller's transcript.

The model and tools then acted on that transcript exactly as received.

## Handling Background Speech

Without source separation, STT mixes every voice that reaches the microphone.
Turn detection cannot reliably distinguish the caller from another speaker,
and the LLM receives one combined transcript.

Voice isolation can remove competing audio before STT. In published real-recording
evaluations, voice isolation reduced overall STT word error rates from about
23.2% to 6.2%. Gains vary by acoustic environment and should be measured for
the target use case.

Even with a clean transcript, interruption handling should validate whether a
detected barge-in is from the caller. Requiring a meaningful speech segment can
prevent coughs, television audio, or other sounds from stopping the agent.

## Chain or Speech-to-Speech

| Approach | Advantages | Tradeoffs |
|---|---|---|
| STT + LLM/RAG + TTS chain | Independent components, caching, observability, lower cost | More handoffs and possible latency |
| Speech-to-speech | Fewer handoffs and lower latency | Less control over individual components and usually higher cost |

A modular chain makes it possible to:

- Swap STT engines or language models
- Cache frequently used TTS audio
- Inspect and audit every transcript and tool call
- Add retrieval, policies, and escalation checks
- Measure each stage independently

A speech-to-speech model gives the system fewer places to instrument and often
answers faster, but changing STT or TTS behavior usually means changing the
whole model.

For many deployments, the practical approach is to start with a chain, measure
latency and containment, then use speech-to-speech for calls where speed justifies
the cost.

## Containment and Escalation

Voice agents are best suited to narrow, repeatable workflows such as:

- Appointment scheduling
- Prescription refills
- Order status
- Account balances
- Frequently asked questions
- Simple intake and routing

Containment is the share of calls the agent resolves without a human. It does
not by itself mean the calls were correct.

Hand a call to a human when both of these apply:

1. The action is expensive or dangerous to get wrong.
2. The input or environment cannot be trusted.

Examples include payment card details, medication dosage, high-value orders,
overlapping speakers, loud environments, and requests that do not satisfy an
explicit safety or business rule.

An appointment booking may be low enough risk to stay automated, while
medication changes or financial transactions should trigger confirmation or
human escalation.

## Testing a Voice Agent

Text-agent tests do not exercise the voice-specific failure modes. Add test
audio that covers:

- Mid-sentence pauses
- Trailing-off speech
- Callers interrupting the agent
- Coughs and television audio
- Multiple speakers
- Accents and domain terminology
- Silence and audio dropouts
- Partial STT transcripts
- Slow STT or LLM providers
- Tool failures and ambiguous retrieval

Record and assert key events in the call log:

```text
caller utterance
partial STT transcript
turn-end decision
final STT transcript
retrieval result
LLM/tool decision
TTS playback
human escalation
```

Important metrics include:

- Time to first partial transcript
- Time to turn decision
- Time to first LLM token
- Time to first audio
- End-to-end response latency
- STT word error rate
- Turn cut-off and false-barge-in rates
- Tool-call accuracy
- Containment
- Human escalation rate
- Correct resolution rate

## Key Takeaway

Voice-agent quality is determined before the LLM reads the first word. STT
writes the transcript, and turn detection decides where each caller turn ends.
The LLM can answer only from that transcript and context.

Test voice agents with real pauses, noise, interruptions, and background voices,
not only with typed text.
