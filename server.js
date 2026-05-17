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
          content: `Search for: ${hotel} hotel photos site:tripadvisor.com OR site:booking.com OR site:hotels.com`
        }]
      })
    });

    const data = await response.json();
    if(data.error) return res.status(502).json({ error: data.error.message });

    // Extraer URLs de imágenes directamente de los tool_result
    const urls = [];
    const imgRegex = /https?:\/\/[^\s"',<>\]\)]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"',<>\]\)]*)?/gi;

    for(const block of (data.content || [])) {
      // Buscar en web_search_tool_result
      if(block.type === 'web_search_tool_result' || block.type === 'tool_result') {
        const content = JSON.stringify(block);
        const found = content.match(imgRegex) || [];
        urls.push(...found);
      }
      // Buscar en server_tool_use (contiene los resultados crudos)
      if(block.type === 'server_tool_use') {
        const content = JSON.stringify(block);
        const found = content.match(imgRegex) || [];
        urls.push(...found);
      }
      // También buscar en texto
      if(block.type === 'text') {
        const found = block.text.match(imgRegex) || [];
        urls.push(...found);
      }
    }

    // Filtrar duplicados y URLs válidas de imágenes de hoteles
    const filtered = [...new Set(urls)]
      .filter(u => !u.includes('logo') && !u.includes('icon') && !u.includes('flag') && !u.includes('avatar'))
      .filter(u => u.length > 30)
      .slice(0, 6);

    console.log('URLs encontradas:', filtered.length, filtered);

    if(filtered.length) return res.json({ urls: filtered });

    // Si no hay imágenes en tool_result, hacer segunda búsqueda más específica
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
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role:    'user',
          content: `Find the official website of "${hotel}" hotel and list the direct URLs of hotel room and pool photos from that website. List each URL on a new line.`
        }]
      })
    });

    const d2 = await r2.json();
    const urls2 = [];
    for(const block of (d2.content || [])) {
      const content = JSON.stringify(block);
      const found = content.match(imgRegex) || [];
      urls2.push(...found);
    }

    const filtered2 = [...new Set(urls2)]
      .filter(u => !u.includes('logo') && !u.includes('icon') && u.length > 30)
      .slice(0, 6);

    console.log('URLs segunda búsqueda:', filtered2.length);

    if(filtered2.length) return res.json({ urls: filtered2 });

    return res.status(502).json({ error: 'No se encontraron imágenes. Intenta subir una manualmente.' });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Cupon backend corriendo en puerto ${PORT}`));
