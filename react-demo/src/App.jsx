import { useRef, useState } from 'react'

const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 480
const FRAME_BYTES = FRAME_SAMPLES * 2

function App() {
  const [started, setStarted] = useState(false)
  const [suppression, setSuppression] = useState(100)
  const [status, setStatus] = useState('Microphone is off')
  const [error, setError] = useState('')
  const [levels, setLevels] = useState(() => Array(28).fill(8))

  const audioRef = useRef(null)
  const socketRef = useRef(null)
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const muteRef = useRef(null)
  const playbackRef = useRef(null)
  const analyserRef = useRef(null)
  const animationRef = useRef(null)
  const readyRef = useRef(false)
  const pendingSamplesRef = useRef(new Float32Array(0))
  const resampleBufferRef = useRef(new Float32Array(0))
  const resamplePositionRef = useRef(0)
  const playbackTimeRef = useRef(0)

  const startVisualizer = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const draw = () => {
      analyser.getByteFrequencyData(data)
      setLevels(
        Array.from({ length: 28 }, (_, index) => {
          const bucket = data[Math.floor(index * (data.length / 28))]
          return Math.max(8, Math.min(88, bucket * 0.45))
        }),
      )
      animationRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  const stopVisualizer = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    setLevels(Array(28).fill(8))
  }

  const reportSocketError = (message) => {
    try {
      const payload = JSON.parse(message)
      setError(payload.error?.message || payload.message || 'Krisp session failed.')
    } catch {
      setError(message || 'Krisp session failed.')
    }
  }

  const stopAudio = async () => {
    readyRef.current = false
    stopVisualizer()

    if (socketRef.current) {
      socketRef.current.onclose = null
      socketRef.current.close()
      socketRef.current = null
    }
    processorRef.current?.disconnect()
    muteRef.current?.disconnect()
    sourceRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    playbackRef.current?.disconnect()
    if (contextRef.current) await contextRef.current.close()
    if (audioRef.current) audioRef.current.srcObject = null

    streamRef.current = null
    contextRef.current = null
    sourceRef.current = null
    processorRef.current = null
    muteRef.current = null
    playbackRef.current = null
    analyserRef.current = null
    pendingSamplesRef.current = new Float32Array(0)
    resampleBufferRef.current = new Float32Array(0)
    resamplePositionRef.current = 0
    playbackTimeRef.current = 0
    setStarted(false)
    setStatus('Microphone is off')
  }

  const queuePcmFrames = (samples, socket) => {
    const pending = pendingSamplesRef.current
    const combined = new Float32Array(pending.length + samples.length)
    combined.set(pending)
    combined.set(samples, pending.length)

    let offset = 0
    while (combined.length - offset >= FRAME_SAMPLES) {
      if (
        socket.readyState === WebSocket.OPEN &&
        readyRef.current &&
        socket.bufferedAmount < FRAME_BYTES * 10
      ) {
        const pcm = new ArrayBuffer(FRAME_BYTES)
        const view = new DataView(pcm)
        for (let i = 0; i < FRAME_SAMPLES; i += 1) {
          const value = Math.max(-1, Math.min(1, combined[offset + i]))
          view.setInt16(
            i * 2,
            value < 0 ? value * 32768 : value * 32767,
            true,
          )
        }
        socket.send(pcm)
      }
      offset += FRAME_SAMPLES
    }

    pendingSamplesRef.current = combined.slice(offset)
  }

  const processMicrophoneAudio = (input, socket, inputRate) => {
    const previous = resampleBufferRef.current
    const buffer = new Float32Array(previous.length + input.length)
    buffer.set(previous)
    buffer.set(input, previous.length)

    const ratio = inputRate / SAMPLE_RATE
    let position = resamplePositionRef.current
    const output = []

    while (position + 1 < buffer.length) {
      const left = Math.floor(position)
      const fraction = position - left
      output.push(
        buffer[left] * (1 - fraction) + buffer[left + 1] * fraction,
      )
      position += ratio
    }

    const consumed = Math.floor(position)
    resampleBufferRef.current = buffer.slice(consumed)
    resamplePositionRef.current = position - consumed
    queuePcmFrames(Float32Array.from(output), socket)
  }

  const playCleanFrame = (data) => {
    const context = contextRef.current
    const destination = playbackRef.current
    if (!context || !destination || data.byteLength !== FRAME_BYTES) return

    const audio = context.createBuffer(1, FRAME_SAMPLES, SAMPLE_RATE)
    const samples = audio.getChannelData(0)
    const view = new DataView(data)
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      samples[i] = view.getInt16(i * 2, true) / 32768
    }

    const player = context.createBufferSource()
    player.buffer = audio
    player.connect(destination)

    const startAt = Math.max(context.currentTime + 0.06, playbackTimeRef.current)
    player.start(startAt)
    playbackTimeRef.current = startAt + audio.duration
  }

  const connectApi = () =>
    new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/voice-isolation`,
      )
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket

      const timeout = window.setTimeout(() => {
        socket.close()
        reject(new Error('Timed out connecting to the Voice Isolation proxy.'))
      }, 12000)

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            sample_rate: SAMPLE_RATE,
            suppression_level: suppression,
          }),
        )
      }

      socket.onmessage = ({ data }) => {
        if (typeof data === 'string') {
          let message
          try {
            message = JSON.parse(data)
          } catch {
            reportSocketError('Received an invalid response from the proxy.')
            return
          }

          if (message.type === 'ready') {
            window.clearTimeout(timeout)
            readyRef.current = true
            setStatus('Voice Isolation is active')
            resolve(socket)
          } else if (message.type === 'error') {
            window.clearTimeout(timeout)
            reportSocketError(data)
            reject(new Error(message.error?.message || 'Krisp session failed.'))
          }
          return
        }

        if (data instanceof ArrayBuffer) {
          playCleanFrame(data)
        }
      }

      socket.onerror = () => {
        window.clearTimeout(timeout)
        reject(
          new Error('Cannot reach the local proxy. Start `npm run proxy` first.'),
        )
      }

      socket.onclose = (event) => {
        window.clearTimeout(timeout)
        readyRef.current = false
        setReady(false)
        if (socketRef.current === socket) socketRef.current = null
        if (event.code !== 1000) {
          setStatus('Voice Isolation disconnected')
          if (event.reason) setError(event.reason)
        }
      }
    })

  const startAudio = async () => {
    setError('')
    setStatus('Requesting microphone access...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      streamRef.current = stream

      const context = new AudioContext()
      contextRef.current = context
      await context.resume()

      const source = context.createMediaStreamSource(stream)
      sourceRef.current = source

      const processor = context.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor
      const mute = context.createGain()
      mute.gain.value = 0
      muteRef.current = mute

      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      const playback = context.createMediaStreamDestination()
      playbackRef.current = playback
      if (audioRef.current) {
        audioRef.current.srcObject = playback.stream
        await audioRef.current.play()
      }

      source.connect(analyser)
      source.connect(processor)
      processor.connect(mute)
      mute.connect(context.destination)

      const socket = await connectApi()
      processor.onaudioprocess = (event) => {
        processMicrophoneAudio(
          event.inputBuffer.getChannelData(0),
          socket,
          context.sampleRate,
        )
      }

      setStarted(true)
      startVisualizer()
    } catch (startError) {
      setError(startError?.message || 'Could not start Voice Isolation.')
      setStatus('Unable to start')
      await stopAudio()
      setStatus('Connection failed')
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <a className="brand" href="/" aria-label="Krisp Voice Lab home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Krisp Voice Lab
        </a>
        <span className="environment">
          <span className="environment-dot" />
          Realtime Voice Isolation API
        </span>
      </nav>

      <section className="stage">
        <header>
          <p className="eyebrow">REAL-TIME AUDIO DEMO</p>
          <h1>Hear the difference.</h1>
          <p className="subtitle">
            Stream microphone audio through Krisp Voice Isolation.
          </p>
        </header>

        <div className={`console ${started ? 'is-live' : ''}`}>
          <div className="console-head">
            <div>
              <span className="status-dot" />
              <span>{status}</span>
            </div>
            <span className="sample-rate">16 kHz · mono · 30 ms frames</span>
          </div>

          <div className="visualizer" aria-label="Microphone activity">
            {levels.map((height, index) => (
              <span
                key={index}
                style={{
                  height: `${height}px`,
                  animationDelay: `${index * 18}ms`,
                }}
              />
            ))}
          </div>

          <div className="suppression">
            <div>
              <label htmlFor="suppression">Suppression level</label>
              <output htmlFor="suppression">{suppression}%</output>
            </div>
            <input
              id="suppression"
              type="range"
              min="0"
              max="100"
              value={suppression}
              disabled={started}
              onChange={(event) => setSuppression(Number(event.target.value))}
            />
            <p>Set before connecting · 0% is passthrough</p>
          </div>

          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}

          <div className="playback">
            <span>ISOLATED OUTPUT</span>
            <audio ref={audioRef} autoPlay controls playsInline />
          </div>

          <div className="controls">
            {!started ? (
              <button className="primary" type="button" onClick={startAudio}>
                <span className="mic-icon" aria-hidden="true">●</span>
                Start microphone
              </button>
            ) : (
              <button className="stop" type="button" onClick={stopAudio}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="features">
          <article>
            <span>01</span>
            <div>
              <h2>Clean audio</h2>
              <p>Receive isolated microphone audio frame by frame.</p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h2>Protected API key</h2>
              <p>Your master key stays on the local backend.</p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h2>30 ms frames</h2>
              <p>16 kHz mono PCM, streamed in real time.</p>
            </div>
          </article>
        </div>
        <p className="privacy-note">
          Live audio is streamed to Krisp for processing. Use headphones to
          avoid speaker audio feeding back into the microphone.
        </p>
      </section>
    </main>
  )
}

export default App
