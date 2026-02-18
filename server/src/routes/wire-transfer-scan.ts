import { Router, Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { PDFParse } from 'pdf-parse';

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

const EXTRACTION_PROMPT = `You are a wire transfer data extraction assistant. Analyze the provided wire transfer proof/receipt and extract the following fields. Return ONLY valid JSON with no extra text.

{
  "amount": "number or null (transfer amount)",
  "transfer_date": "string or null (YYYY-MM-DD format)",
  "bank_reference": "string or null (bank reference/confirmation number)",
  "notes": "string or null (brief summary of the transfer, sender/receiver info)"
}

Rules:
- Return only the JSON object, no markdown fences or extra text
- For amounts, return the numeric value only (no currency symbols)
- For dates, convert to YYYY-MM-DD format
- If a field cannot be determined, use null
- For notes, summarize key details like sender, receiver, bank names (max 200 chars)`;

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
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      const textResult = await parser.getText();
      text = textResult.text.slice(0, 8000);
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
          content: `${EXTRACTION_PROMPT}\n\nWire transfer document text:\n${text}`,
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
      amount: extracted.amount != null ? Number(extracted.amount) : null,
      transfer_date: extracted.transfer_date || null,
      bank_reference: extracted.bank_reference || null,
      notes: extracted.notes || null,
    };

    res.json(result);
  } catch (err: any) {
    if (err.message === 'NO_API_KEY') {
      res.status(501).json({ error: 'AI scanning is not configured' });
      return;
    }
    console.error('Wire transfer scan error:', err.message || err);
    res.status(500).json({ error: `Failed to scan wire transfer: ${err.message || 'Unknown error'}` });
  }
});

export default router;
