const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'cupon-backend' }));

// ── Proxy → Anthropic API ──────────────────────────────────
app.post('/api/buscar-imagenes', async (req, res) => {
  const hotel = (req.body.hotel || '').trim();
  if(!hotel) return res.status(400).json({ error: 'Falta el nombre del hotel' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if(!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            ANTHROPIC_KEY,
        'anthropic-version':    '2023-06-01',
        'anthropic-beta':       'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `Eres un asistente especializado en encontrar imágenes de hoteles.
Usa web_search para buscar fotos del hotel en sitios como tripadvisor.com, booking.com, hotels.com, marriott.com, hilton.com, riu.com, iberostar.com, palladiumhotelgroup.com.
Responde ÚNICAMENTE con JSON válido, sin texto extra, sin markdown, sin backticks:
{"urls":["url1","url2","url3","url4","url5","url6"]}
Las URLs deben ser imágenes directas (jpg, jpeg, png, webp) de alta resolución del hotel.`,
        messages: [{
          role:    'user',
          content: `Busca 6 imágenes del hotel: ${hotel}. Solo devuelve el JSON.`
        }]
      })
    });

    const data = await response.json();

    if(data.error) return res.status(502).json({ error: data.error.message });

    // Extraer texto de todos los bloques
    let text = '';
    for(const block of (data.content || [])){
      if(block.type === 'text') text += block.text;
    }

    // Limpiar y parsear JSON
    text = text.replace(/```json|```/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if(!match) return res.status(502).json({ error: 'No se encontraron imágenes' });

    const parsed = JSON.parse(match[0]);
    res.json({ urls: parsed.urls || [] });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Cupon backend corriendo en puerto ${PORT}`));
