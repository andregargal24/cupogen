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
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role:    'user',
          content: `Search for photos of hotel "${hotel}". Find direct image URLs (jpg, jpeg, png) from tripadvisor, booking.com, or the hotel's official website. Return ONLY a JSON array like this with no other text: {"urls":["https://...jpg","https://...jpg","https://...jpg","https://...jpg","https://...jpg","https://...jpg"]}`
        }]
      })
    });

    const data = await response.json();
    console.log('API response stop_reason:', data.stop_reason);
    console.log('Content blocks:', JSON.stringify(data.content?.map(b => ({type: b.type, text: b.text?.slice(0,200)})), null, 2));

    if(data.error) return res.status(502).json({ error: data.error.message });

    // Si Claude usó web_search, continuamos la conversación
    if(data.stop_reason === 'tool_use') {
      const messages = [
        { role: 'user', content: `Search for photos of hotel "${hotel}". Find direct image URLs (jpg, jpeg, png) from tripadvisor, booking.com, or the hotel's official website. Return ONLY a JSON array like this with no other text: {"urls":["https://...jpg","https://...jpg","https://...jpg","https://...jpg","https://...jpg","https://...jpg"]}` },
        { role: 'assistant', content: data.content },
        { role: 'user', content: data.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed' }))
        }
      ];

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
          max_tokens: 500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages
        })
      });

      const d2 = await r2.json();
      console.log('Round 2 content:', JSON.stringify(d2.content?.map(b => ({type: b.type, text: b.text?.slice(0,300)})), null, 2));

      let text = '';
      for(const b of (d2.content || [])) if(b.type === 'text') text += b.text;

      // Extraer URLs del JSON
      const jsonMatch = text.replace(/```json|```/g,'').match(/\{[\s\S]*?\}/);
      if(jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const urls = (parsed.urls || []).filter(u => u && u.startsWith('http'));
          if(urls.length) return res.json({ urls });
        } catch(e) { console.log('JSON parse error:', e.message); }
      }

      // Fallback regex
      const urlRegex = /https?:\/\/[^\s"',<>\]\)]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"',<>\]\)]*)?/gi;
      const urls = [...new Set(text.match(urlRegex) || [])].slice(0, 6);
      console.log('Regex URLs found:', urls);
      if(urls.length) return res.json({ urls });
    }

    // Si respondió directo sin tool_use
    let text = '';
    for(const b of (data.content || [])) if(b.type === 'text') text += b.text;
    const jsonMatch = text.replace(/```json|```/g,'').match(/\{[\s\S]*?\}/);
    if(jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const urls = (parsed.urls || []).filter(u => u && u.startsWith('http'));
        if(urls.length) return res.json({ urls });
      } catch(e) {}
    }

    return res.status(502).json({ error: 'No se encontraron imágenes para ese hotel' });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Cupon backend corriendo en puerto ${PORT}`));
