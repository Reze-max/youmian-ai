// Vercel Serverless Function: LLM 代理
// 接收前端 /api/llm 请求，从环境变量读 KEY，转发到真实 LLM 端点
// 优势：API KEY 完全隐藏在 Vercel 后端，前端 view-source 看不到
export default async function handler(req, res) {
  // CORS（Vercel 默认同源，但兼容自定义域名/跨域调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { system, messages, stream, jsonMode, maxTokens, temperature } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  // 从 Vercel 环境变量读 KEY（不进 Git，view-source 看不到）
  const apiKey = process.env.LLM_API_KEY;
  const endpoint = process.env.LLM_ENDPOINT || 'https://api.MiniMax.chat/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'MiniMax-M3';

  if (!apiKey) {
    return res.status(500).json({ error: 'LLM_API_KEY not configured on server. Set it in Vercel Dashboard → Settings → Environment Variables.' });
  }

  const body = {
    model: model,
    messages: [{ role: 'system', content: system || '' }, ...messages],
    stream: !!stream,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    max_tokens: maxTokens || 1000
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body)
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: 'Upstream error', detail: errText.slice(0, 500) });
    }

    if (stream) {
      // 流式：透传 SSE（保证 P07 流式输出体验）
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } finally {
        res.end();
      }
    } else {
      // 非流式：直接返回 JSON
      const data = await upstream.json();
      res.status(200).json(data);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Proxy error', detail: e.message });
  }
}