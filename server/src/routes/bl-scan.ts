import { Router, Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore — import lib directly to avoid pdf-parse's debug-mode crash in ESM
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, PNG, and WebP files are allowed'));
    }
  },
});

const EXTRACTION_PROMPT = `You are a Bill of Lading (B/L) data extraction assistant. Analyze the provided Bill of Lading document and extract the following fields. Return ONLY valid JSON with no extra text.

{
  "bl_date": "string or null (YYYY-MM-DD format)",
  "bl_number": "string or null (the Bill of Lading number / document number)",
  "notes": "string or null (brief summary: vessel, ports, shipper/consignee)"
}

How to determine bl_date:
- Prefer the "Shipped on Board" date (the date the cargo was loaded on the vessel) — this is the date payment terms like "60 days from BL" are counted from.
- If there is no "Shipped on Board" date, use the Bill of Lading issue date.
- Convert the date to YYYY-MM-DD format. Be careful with day/month ordering — shipping documents are usually DD/MM/YYYY.

Rules:
- Return only the JSON object, no markdown fences or extra text
- If a field cannot be determined, use null
- For notes, keep it short (max 200 chars)`;

function getMediaType(originalname: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = originalname.toLowerCase().slice(originalname.lastIndexOf('.'));
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function extractWithClaude(file: Express.Multer.File): Promise<Record<string, any>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const client = new Anthropic({ apiKey });
  const isPdf = file.originalname.toLowerCase().endsWith('.pdf');

  let response;

  if (isPdf) {
    let text = '';
    try {
      const textResult = await (pdfParse as any)(file.buffer);
      text = (textResult.text || '').slice(0, 8000);
    } catch (pdfErr) {
      console.warn('PDF text extraction failed:', pdfErr);
      text = `[PDF file: ${file.originalname}, size: ${file.size} bytes. Text extraction failed.]`;
    }

    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\nBill of Lading document text:\n${text}`,
        },
      ],
    });
  } else {
    const base64 = file.buffer.toString('base64');
    const mediaType = getMediaType(file.originalname);

    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });
  }

  const textBlock = response.content.find((b: any) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Strip markdown code fences
  let rawText = textBlock.text.trim();
  const fenceMatch = rawText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    rawText = fenceMatch[1].trim();
  }

  return JSON.parse(rawText);
}

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(501).json({ error: 'AI scanning is not configured (missing API key)' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const extracted = await extractWithClaude(req.file);

    const result = {
      bl_date: extracted.bl_date || null,
      bl_number: extracted.bl_number || null,
      notes: extracted.notes || null,
    };

    res.json(result);
  } catch (err: any) {
    if (err.message === 'NO_API_KEY') {
      res.status(501).json({ error: 'AI scanning is not configured' });
      return;
    }
    console.error('BL scan error:', err.message || err);
    res.status(500).json({ error: `Failed to scan Bill of Lading: ${err.message || 'Unknown error'}` });
  }
});

export default router;
