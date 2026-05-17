const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', service: 'cupon-backend' }));

app.post('/api/buscar-imagenes', async (req, res) => {
  const hotel = (req.body.hotel || '').trim();
  if(!hotel) return res.status(400).json({ error: 'Falta el nombre del hotel' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if(!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `Busca imágenes del hotel y responde SOLO con este JSON (sin texto extra, sin markdown):
{"urls":["url1","url2","url3","url4","url5","url6"]}
URLs deben ser imágenes directas jpg/jpeg/png/webp del hotel.`,
        messages: [{
          role:    'user',
          content: `Encuentra 6 URLs de imágenes del hotel: ${hotel}`
        }]
      })
    });

    const data = await response.json();
    if(data.error) return res.status(502).json({ error: data.error.message });

    // Manejar flujo multi-turno si Claude usó web_search
    let messages = [
      { role: 'user', content: `Encuentra 6 URLs de imágenes del hotel: ${hotel}` },
      { role: 'assistant', content: data.content }
    ];

    let finalText = '';

    if(data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'OK' }));

      messages.push({ role: 'user', content: toolResults });

      const r2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'web-search-2025-03-05'
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 400,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `Responde SOLO con JSON sin texto extra:
{"urls":["url1","url2","url3","url4","url5","url6"]}`,
          messages
        })
      });

      const d2 = await r2.json();
      if(d2.error) return res.status(502).json({ error: d2.error.message });
      for(const b of (d2.content || [])) if(b.type === 'text') finalText += b.text;
    } else {
      for(const b of (data.content || [])) if(b.type === 'text') finalText += b.text;
    }

    // Parsear respuesta
    finalText = finalText.replace(/```json|```/g, '').trim();
    const jsonMatch = finalText.match(/\{[\s\S]*?\}/);
    if(jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const urls = (parsed.urls || []).filter(u => u && u.startsWith('http'));
        if(urls.length) return res.json({ urls });
      } catch(e) {}
    }

    // Fallback: regex para URLs de imágenes
    const urlRegex = /https?:\/\/[^\s"',<>\]]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"',<>\]]*)?/gi;
    const urls = [...new Set(finalText.match(urlRegex) || [])].slice(0, 6);
    if(urls.length) return res.json({ urls });

    return res.status(502).json({ error: 'No se encontraron imágenes para ese hotel' });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Cupon backend corriendo en puerto ${PORT}`));
