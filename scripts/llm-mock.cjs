const http = require('http')

const port = 8787
const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || ''
  const url = req.url || ''
  if (url.startsWith('/v1/models')) {
    if (auth !== 'Bearer sk-mock-ok') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'deepseek-chat' }] }))
    return
  }
  if (url.startsWith('/v1/chat/completions')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(port, '127.0.0.1', () => console.log(`mock LLM on http://127.0.0.1:${port}/v1`))
