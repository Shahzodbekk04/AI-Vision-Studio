import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 10000);

app.disable('x-powered-by');
app.use(express.json({ limit: '18mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const languages = {
  uz: `Javob faqat ravon, tabiiy o'zbek tilida, lotin yozuvida bo'lsin. So'zlar xalqchil bo'lishi mumkin, lekin tushunarsiz aralash til ishlatma. Yakun bo'limi nomi: XULOSA.`,
  ru: `Отвечай только на естественном современном русском языке. Не переводи узбекские идиомы дословно. Финальный раздел: ВЫВОД.`,
  en: `Answer only in natural English. Adapt idioms naturally. Final section title: CONCLUSION.`
};

const personas = {
  prank: `Kulgili kuzatuvchi bo'l. Yengil sarkazm, memga o'xshash taqqoslash va kuchli punchline ishlat, lekin hazil uchun rasm faktlarini o'zgartirma.`,
  podcast: `Professional podkast boshlovchisi kabi gapir. Jonli kirish, kuzatuvlar, auditoriyaga murojaat va silliq hikoya ritmi bo'lsin.`,
  street: `Zamonaviy shahar yoshlari uslubida erkin, samimiy, biroz derzkiy gapir. Sun'iy yoki haqoratli jargon ishlatma.`,
  factual: `Mutlaqo faktik computer-vision analitigi bo'l. Hazil va hissiy baho yo'q. Obyekt, rang, yorug'lik, kompozitsiya, perspektiva, fon, matn va noaniqliklarni tizimli yoz.`,
  teaHouse: `Tilga mos madaniy suhbat uslubi: o'zbekchada choyxonadagi tajribali amakilar, ruschada tabiiy “мужики за столом/в гараже”, inglizchada seasoned neighborhood uncles. Dialog va hayotiy kuzatuv bo'lishi mumkin.`,
  standup: `Stand-up komik ritmida: observation → setup → punchline. Vaziyat komediyasiga urg'u ber, odamni kamsitma.`,
  detective: `Tajribali tergovchi kabi mayda detallarga qarab deduktiv tahlil qil. Lekin dalilsiz jinoyat, ayb yoki yashirin voqeani fakt deb e'lon qilma.`,
  philosopher: `Avval real vizual mazmunni ayt, keyin faqat ko'rinayotgan motivlardan falsafiy ma'no chiqar. Metaforani fakt bilan aralashtirma.`,
  commentator: `Yuqori energiyali jonli efir sharhlovchisi kabi gapir. Statik kadrdan oldin/keyin nima bo'lganini fakt qilib to'qima.`
};

const warningText = {
  uz: `🔴 OGOHLANTIRISH:\nTasvirda kattalar uchun, zo'ravonlik, o'ziga zarar yetkazish yoki potensial noqonuniy holatga oid mazmun belgilari bor. Agar tasvirdagi harakat real zarar yetkazadigan bo'lsa, uni takrorlash, targ'ib qilish yoki romantizatsiya qilish to'g'ri emas. Inson sha'ni, xavfsizlik, rozilik va qonunga hurmatni ustun qo'ying.`,
  ru: `🔴 ПРЕДУПРЕЖДЕНИЕ:\nНа изображении есть признаки контента для взрослых, насилия, самоповреждения или потенциально противоправной ситуации. Не следует поощрять, романтизировать или повторять действия, причиняющие реальный вред.`,
  en: `🔴 WARNING:\nThe image shows signs of adult, violent, self-harm-related, or potentially unlawful content. Conduct involving real harm should not be encouraged, romanticized, or repeated.`
};

function buildPrompt(persona, language) {
  return `You are an image-analysis assistant.\n\nVISUAL ACCURACY RULES:\n- Describe only what is actually visible.\n- Never invent people, objects, brands, text, locations, motives, crimes, events before/after the frame, or hidden details.\n- If uncertain, explicitly say it is uncertain.\n- Separate direct observation from inference.\n- Do not identify an unknown real person from face alone.\n- Do not infer sensitive traits such as ethnicity, religion, health, politics, sexual orientation, or criminality from appearance.\n- Persona changes STYLE only, never FACTS.\n\nLANGUAGE:\n${languages[language] || languages.uz}\n\nPERSONA:\n${personas[persona] || personas.factual}\n\nReturn ONLY valid JSON, no markdown fences, exactly this shape:\n{\n  "title": "short title",\n  "visibleFacts": ["fact 1", "fact 2"],\n  "analysis": "full persona analysis",\n  "conclusion": "one clear overall conclusion",\n  "flags": {"adult":false,"violence":false,"graphic":false,"possibleIllegalActivity":false,"selfHarm":false}\n}`;
}

function extractText(json) {
  return json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')?.trim() || '';
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('AI JSON javob qaytarmadi.');
}

function formatResult(data, language) {
  const labels = {
    uz: { facts: "KO'RINAYOTGAN FAKTLAR", conclusion: 'XULOSA' },
    ru: { facts: 'ВИДИМЫЕ ФАКТЫ', conclusion: 'ВЫВОД' },
    en: { facts: 'VISIBLE FACTS', conclusion: 'CONCLUSION' }
  }[language] || { facts: "KO'RINAYOTGAN FAKTLAR", conclusion: 'XULOSA' };
  let out = data.title ? `## ${data.title}\n\n` : '';
  if (Array.isArray(data.visibleFacts) && data.visibleFacts.length) {
    out += `### ${labels.facts}\n${data.visibleFacts.map(x => `• ${x}`).join('\n')}\n\n`;
  }
  out += `${data.analysis || ''}\n\n### ${labels.conclusion}\n${data.conclusion || ''}`;
  const f = data.flags || {};
  if (f.adult || f.violence || f.graphic || f.possibleIllegalActivity || f.selfHarm) out += `\n\n${warningText[language] || warningText.uz}`;
  return out.trim();
}

async function callGemini({ imageBase64, mimeType, persona, language }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Serverda GEMINI_API_KEY sozlanmagan.'), { status: 500 });
  const models = [...new Set([process.env.GEMINI_MODEL || 'gemini-3.8-flash', 'gemini-3.7-flash'])];
  let lastError;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 70000);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildPrompt(persona, language) }] },
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: 'Rasmni juda sinchiklab tahlil qil. Avval vizual faktlarni tekshir, keyin tanlangan persona uslubida yoz. Faqat talab qilingan JSONni qaytar.' }
            ] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 5000,
              thinkingConfig: { thinkingLevel: 'low' }
            }
          })
        });
        clearTimeout(timer);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error?.message || `Gemini HTTP ${res.status}`;
          const e = new Error(msg); e.status = res.status; throw e;
        }
        const text = extractText(json);
        if (!text) throw new Error('Gemini bo‘sh javob qaytardi.');
        const parsed = parseJson(text);
        return { model, data: parsed, formatted: formatResult(parsed, language) };
      } catch (err) {
        lastError = err;
        const retryable = err.name === 'AbortError' || [408, 429, 500, 502, 503, 504].includes(err.status);
        if (!retryable) break;
        await new Promise(r => setTimeout(r, 900 + attempt * 1200));
      }
    }
  }
  throw lastError || new Error('AI tahlil bajarilmadi.');
}

app.get('/health', (_req, res) => res.json({ ok: true, model: process.env.GEMINI_MODEL || 'gemini-3.8-flash', apiConfigured: Boolean(process.env.GEMINI_API_KEY) }));

app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', persona = 'factual', language = 'uz' } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: "Rasm ma'lumoti kelmadi." });
    if (!['image/jpeg','image/png','image/webp'].includes(mimeType)) return res.status(400).json({ error: "JPEG, PNG yoki WEBP yuboring." });
    if (!personas[persona]) return res.status(400).json({ error: "Noto'g'ri tahlil uslubi." });
    if (!languages[language]) return res.status(400).json({ error: "Noto'g'ri til." });
    const approxBytes = Math.floor(imageBase64.length * 3 / 4);
    if (approxBytes > 11 * 1024 * 1024) return res.status(413).json({ error: 'Rasm juda katta. Boshqa rasm tanlang.' });

    const result = await callGemini({ imageBase64, mimeType, persona, language });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    const status = err.status === 429 ? 429 : (err.status >= 400 && err.status < 500 ? err.status : 500);
    let message = err.name === 'AbortError' ? 'AI javobi juda uzoq cho‘zildi. Qayta urinib ko‘ring.' : (err.message || 'Server xatosi.');
    if (status === 429) message = 'Gemini limiti vaqtincha tugagan (429). Birozdan keyin qayta urinib ko‘ring yoki API kvotani tekshiring.';
    res.status(status).json({ error: message });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`AI Vision Studio running on ${PORT}`));
