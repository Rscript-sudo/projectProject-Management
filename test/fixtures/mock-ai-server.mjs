import http from 'node:http'

const expectedKey = process.env.MOCK_API_KEY || ''
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${expectedKey}`) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid authorization' }))
    return
  }
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && req.url === '/models') {
    res.end(JSON.stringify({ data: [{ id: 'mock-recommended-model' }, { id: 'mock-backup-model' }] }))
    return
  }
  let body = ''
  for await (const chunk of req) body += chunk
  const payload = JSON.parse(body || '{}')
  if (payload.model !== 'mock-vision-model' || !payload.messages?.[1]?.content?.some(item => item.type === 'image_url')) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: 'invalid multimodal payload' }))
    return
  }
  res.end(JSON.stringify({ choices: [{ message: { content: '可见配电箱门开启，箱内线路状态需现场复核。' } }] }))
})

server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`))
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
