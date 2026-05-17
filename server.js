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
    // Paso 1: Claude busca en la web
    const r1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `Cuando busques imágenes de un hotel, devuelve ÚNICAMENTE este JSON sin texto extra:
{"urls":["url1","url2","url3","url4","url5","url6"]}
Las URLs deben ser imágenes directas (jpg, jpeg, png, webp) del hotel.`,
        messages: [{
          role:    'user',
          content: `Busca 6 imágenes del hotel "${hotel}". Busca en tripadvisor.com, booking.com, o el sitio oficial. Devuelve solo el JSON con las URLs de imágenes directas.`
        }]
      })
    });

    const d1 = await r1.json();
    if(d1.error) return res.status(502).json({ error: d1.error.message });

    // Construir historial de mensajes
    let messages = [
      { role: 'user', content: `Busca 6 imágenes del hotel "${hotel}". Busca en tripadvisor.com, booking.com, o el sitio oficial. Devuelve solo el JSON con las URLs de imágenes directas.` },
      { role: 'assistant', content: d1.content }
    ];

    let finalText = '';

    if(d1.stop_reason === 'tool_use') {
      // Procesar resultados de la búsqueda
      const toolResults = d1.content
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
          model:      'claude-sonnet-4-5',
          max_tokens: 500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `Devuelve ÚNICAMENTE este JSON sin texto extra ni markdown:
{"urls":["url1","url2","url3","url4","url5","url6"]}
Con URLs directas de imágenes (jpg, jpeg, png, webp) del hotel encontradas en la búsqueda.`,
          messages
        })
      });

      const d2 = await r2.json();
      if(d2.error) return res.status(502).json({ error: d2.error.message });
      for(const b of (d2.content || [])) if(b.type === 'text') finalText += b.text;
    } else {
      for(const b of (d1.content || [])) if(b.type === 'text') finalText += b.text;
    }

    // Extraer URLs del texto
    finalText = finalText.replace(/```json|```/g, '').trim();

    // Intentar parsear JSON
    const jsonMatch = finalText.match(/\{[\s\S]*?\}/);
    if(jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const urls = (parsed.urls || []).filter(u => u && u.startsWith('http'));
        if(urls.length) return res.json({ urls });
      } catch(e) {}
    }

    // Fallback: extraer URLs directas del texto
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
