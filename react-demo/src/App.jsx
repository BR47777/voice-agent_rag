import { useRef, useState } from 'react'

const sdkPath =
  import.meta.env.VITE_KRISP_SDK_PATH || '/krisp/krispsdk.mjs'

const modelPaths = {
  model8: import.meta.env.VITE_KRISP_MODEL_8 || '/krisp/models/model_8.kef',
  modelNC:
    import.meta.env.VITE_KRISP_MODEL_NC || '/krisp/models/model_nc.kef',
}

function App() {
  const [started, setStarted] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [sdkLoaded, setSdkLoaded] = useState(false)
  const [status, setStatus] = useState('Microphone is off')
  const [error, setError] = useState('')
  const [levels, setLevels] = useState(() => Array(28).fill(8))

  const audioRef = useRef(null)
  const sdkRef = useRef(null)
  const streamRef = useRef(null)
  const filterRef = useRef(null)
  const contextRef = useRef(null)
  const sourceRef = useRef(null)
  const destinationRef = useRef(null)
  const analyserRef = useRef(null)
  const animationRef = useRef(null)

  const startVisualizer = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const draw = () => {
      analyser.getByteFrequencyData(data)
      const next = Array.from({ length: 28 }, (_, index) => {
        const bucket = data[Math.floor(index * (data.length / 28))]
        return Math.max(8, Math.min(88, bucket * 0.45))
      })
      setLevels(next)
      animationRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  const stopVisualizer = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    setLevels(Array(28).fill(8))
  }

  const stopAudio = async () => {
    stopVisualizer()
    sourceRef.current?.disconnect()
    destinationRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    filterRef.current?.disconnect()

    if (filterRef.current?.dispose) {
      await filterRef.current.dispose()
    }
    if (contextRef.current) {
      await contextRef.current.suspend()
    }
    sdkRef.current?.dispose()
    if (audioRef.current) audioRef.current.srcObject = null

    sourceRef.current = null
    destinationRef.current = null
    streamRef.current = null
    filterRef.current = null
    contextRef.current = null
    analyserRef.current = null
    sdkRef.current = null
    setStarted(false)
    setEnabled(false)
    setSdkLoaded(false)
    setStatus('Microphone is off')
  }

  const startAudio = async () => {
    setError('')
    setStatus('Requesting microphone access...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
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

      const destination = context.createMediaStreamDestination()
      destinationRef.current = destination

      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      let processedStream = stream

      try {
        const module = await import(/* @vite-ignore */ sdkPath)
        const KrispSDK = module.default
        const sdk = new KrispSDK({
          params: {
            logProcessStats: false,
            debugLogs: false,
            models: modelPaths,
            useSharedArrayBuffer: false,
          },
          callbacks: {
            errorCallback: (sdkError) =>
              setError(sdkError?.message || 'Krisp SDK error'),
          },
        })
        sdkRef.current = sdk
        sdk.init()

        const filter = await sdk.createNoiseFilter(context, () => {
          setEnabled(true)
        })
        filterRef.current = filter
        filter.enable()
        setSdkLoaded(true)
        source.connect(filter)
        filter.connect(destination)
        processedStream = destination.stream
        setStatus('Krisp noise cancellation is active')
      } catch (sdkError) {
        source.connect(destination)
        processedStream = destination.stream
        setError(
          'Krisp SDK files were not found. The app is running with the original microphone audio.',
        )
        setStatus('Running in preview mode')
        console.warn(sdkError)
      }

      source.connect(analyser)
      analyser.connect(context.destination)

      if (audioRef.current) {
        audioRef.current.srcObject = processedStream
        await audioRef.current.play()
      }

      setStarted(true)
      setEnabled(Boolean(filterRef.current))
      startVisualizer()
    } catch (requestError) {
      setError(requestError?.message || 'Unable to access the microphone')
      setStatus('Microphone unavailable')
    }
  }

  const toggleFilter = () => {
    if (!filterRef.current) return
    if (enabled) {
      filterRef.current.disable()
      setEnabled(false)
      setStatus('Krisp noise cancellation is paused')
    } else {
      filterRef.current.enable()
      setEnabled(true)
      setStatus('Krisp noise cancellation is active')
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
          Live demo
        </span>
      </nav>

      <section className="stage">
        <header>
          <p className="eyebrow">REAL-TIME AUDIO DEMO</p>
          <h1>Hear the difference.</h1>
          <p className="subtitle">
            Test noise cancellation directly in your browser.
          </p>
        </header>

        <div className={`console ${started ? 'is-live' : ''}`}>
          <div className="console-head">
            <div>
              <span className="status-dot" />
              <span>{status}</span>
            </div>
            <span className="sample-rate">48 kHz</span>
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

          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}

          <audio ref={audioRef} hidden />

          <div className="controls">
            {!started ? (
              <button className="primary" type="button" onClick={startAudio}>
                <span className="mic-icon" aria-hidden="true">●</span>
                Start microphone
              </button>
            ) : (
              <>
                <button
                  className={`toggle ${enabled ? 'enabled' : ''}`}
                  type="button"
                  onClick={toggleFilter}
                  disabled={!sdkLoaded}
                >
                  <span className="toggle-track">
                    <span />
                  </span>
                  Krisp filter
                </button>
                <button className="stop" type="button" onClick={stopAudio}>
                  Stop
                </button>
              </>
            )}
          </div>
        </div>

        <div className="features">
          <article>
            <span>01</span>
            <div>
              <h2>Cleaner speech</h2>
              <p>Reduce room noise and competing voices.</p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h2>Local processing</h2>
              <p>Audio stays in the browser with the installed SDK.</p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h2>One-tap control</h2>
              <p>Compare filtered and original microphone audio.</p>
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}

export default App
