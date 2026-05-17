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

  try {
    // Buscar en Bing Images (sin API key, scraping del HTML)
    const query = encodeURIComponent(`${hotel} hotel`);
    const bingUrl = `https://www.bing.com/images/search?q=${query}&form=HDRSC2&first=1&tsc=ImageHoverTitle`;

    const r = await fetch(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      }
    });

    const html = await r.text();

    // Extraer URLs de imágenes del JSON embebido en el HTML de Bing
    const imgRegex = /"murl":"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    const urls = [];
    let match;
    while((match = imgRegex.exec(html)) !== null && urls.length < 9) {
      try {
        const url = match[1].replace(/\\u002f/g, '/').replace(/\\\//g, '/');
        if(url.startsWith('http')) urls.push(url);
      } catch(e) {}
    }

    const unique = [...new Set(urls)].slice(0, 6);
    console.log(`Hotel: ${hotel} — imágenes encontradas: ${unique.length}`);

    if(unique.length) return res.json({ urls: unique });

    // Fallback: DuckDuckGo
    const ddgUrl = `https://duckduckgo.com/?q=${query}&iax=images&ia=images`;
    const r2 = await fetch(ddgUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html2 = await r2.text();
    const token = html2.match(/vqd=([\d-]+)/)?.[1];

    if(token) {
      const ddgImgUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${query}&vqd=${token}&f=,,,&p=1`;
      const r3 = await fetch(ddgImgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://duckduckgo.com'
        }
      });
      const data = await r3.json();
      const ddgUrls = (data.results || [])
        .map(r => r.image)
        .filter(u => u && u.startsWith('http'))
        .slice(0, 6);

      if(ddgUrls.length) return res.json({ urls: ddgUrls });
    }

    return res.status(502).json({ error: 'No se encontraron imágenes. Intenta subir una manualmente.' });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Cupon backend corriendo en puerto ${PORT}`));
