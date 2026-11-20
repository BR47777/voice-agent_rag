import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

const port = Number(process.env.PROXY_PORT || 8787)
const host = process.env.PROXY_HOST || '127.0.0.1'
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim()),
)
const apiKey = process.env.KRISP_API_KEY

const server = createServer((_request, response) => {
  response.writeHead(404, { 'Content-Type': 'text/plain' })
  response.end('WebSocket proxy only')
})

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 65536 })
const activeSessions = new Set()
const maxSessions = 5

server.on('upgrade', (request, socket, head) => {
  let pathname
  try {
    pathname = new URL(request.url, `http://${request.headers.host}`).pathname
  } catch {
    socket.destroy()
    return
  }

  if (
    pathname !== '/voice-isolation' ||
    !allowedOrigins.has(request.headers.origin)
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }

  webSockets.handleUpgrade(request, socket, head, (client) => {
    webSockets.emit('connection', client)
  })
})

function sendError(socket, code, message, closeCode = 1011) {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ type: 'error', error: { code, message } }))
  socket.close(closeCode, message.slice(0, 100))
}

async function createSessionToken() {
  if (!apiKey) {
    throw new Error('Set KRISP_API_KEY in the backend environment.')
  }

  const response = await fetch(
    'https://api.developers.krisp.ai/v2/sdk/tokens/session',
    {
      method: 'POST',
      headers: {
        Authorization: `api-key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usage_type: 'viva',
        expiration_ttl: 5,
        metadata: { session_id: randomUUID() },
      }),
      signal: AbortSignal.timeout(10000),
    },
  )

  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.data?.session_key) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : `Krisp token request failed (${response.status}).`
    throw new Error(message)
  }

  return body.data.session_key
}

webSockets.on('connection', (client) => {
  if (activeSessions.size >= maxSessions) {
    sendError(client, 'session_limit', 'Demo session limit reached.', 1013)
    return
  }

  activeSessions.add(client)
  let upstream
  let initialized = false
  let ready = false

  const helloTimeout = setTimeout(() => {
    sendError(client, 'client_hello_timeout', 'Send session settings to begin.', 1008)
  }, 10000)

  client.on('message', async (message, isBinary) => {
    if (!initialized) {
      initialized = true
      clearTimeout(helloTimeout)

      if (isBinary) {
        sendError(client, 'invalid_client_hello', 'Expected JSON session settings.', 1008)
        return
      }

      let config
      try {
        config = JSON.parse(message.toString())
      } catch {
        sendError(client, 'invalid_client_hello', 'Session settings must be valid JSON.', 1008)
        return
      }

      if (
        config?.sample_rate !== 16000 ||
        typeof config?.suppression_level !== 'number' ||
        config.suppression_level < 0 ||
        config.suppression_level > 100
      ) {
        sendError(
          client,
          'invalid_client_hello',
          'Use a 16000 Hz sample rate and suppression level from 0 to 100.',
          1008,
        )
        return
      }

      try {
        const sessionToken = await createSessionToken()
        if (client.readyState !== WebSocket.OPEN) return

        upstream = new WebSocket('wss://streaming.krisp.ai/voice-isolation', {
          headers: { Authorization: `api-key ${sessionToken}` },
          handshakeTimeout: 10000,
          maxPayload: 65536,
        })

        upstream.on('open', () => {
          upstream.send(
            JSON.stringify({
              model: 'VIVA-tel',
              sample_rate: 16000,
              suppression_level: config.suppression_level,
            }),
          )
        })

        upstream.on('message', (data, binary) => {
          if (!binary) {
            try {
              const control = JSON.parse(data.toString())
              if (control.type === 'ready') ready = true
            } catch {
              sendError(client, 'upstream_protocol_error', 'Invalid response from Krisp.')
              return
            }
          }

          if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary })
          }
        })

        upstream.on('close', (code, reason) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(code || 1000, reason.toString().slice(0, 100))
          }
        })

        upstream.on('error', () => {
          sendError(client, 'upstream_connection_failed', 'Could not connect to Krisp.')
        })
      } catch (error) {
        sendError(client, 'session_setup_failed', error.message)
      }
      return
    }

    if (!isBinary || !ready || !upstream || upstream.readyState !== WebSocket.OPEN) {
      sendError(client, 'invalid_audio_state', 'Audio is accepted only after the Krisp session is ready.', 1008)
      return
    }

    if (message.length !== 960) {
      sendError(client, 'invalid_frame_duration', 'Send exactly 960-byte, 30 ms PCM frames.', 1008)
      return
    }

    if (upstream.bufferedAmount > 65536) {
      sendError(client, 'audio_backpressure', 'Audio stream is falling behind.', 1013)
      return
    }

    upstream.send(message, { binary: true })
  })

  client.on('close', () => {
    clearTimeout(helloTimeout)
    activeSessions.delete(client)
    if (
      upstream &&
      (upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING)
    ) {
      upstream.close()
    }
  })

  client.on('error', () => {
    activeSessions.delete(client)
    upstream?.close()
  })
})

server.listen(port, host, () => {
  console.log(`Krisp WebSocket proxy listening on ws://${host}:${port}/voice-isolation`)
})
