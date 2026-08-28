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

const EXTRACTION_PROMPT = `You are a wire transfer data extraction assistant. Analyze the provided wire transfer proof/receipt (SWIFT MT103, bank confirmation, payment advice, screenshot...) and extract the following fields. Return ONLY valid JSON with no extra text.

{
  "amount": "number or null (the amount actually transferred)",
  "currency": "string or null (3-letter ISO code of the transfer amount, e.g. EUR, USD)",
  "transfer_date": "string or null (YYYY-MM-DD format)",
  "bank_reference": "string or null (bank reference/confirmation/transaction number)",
  "payer_name": "string or null (the COMPANY THAT SENT the money: ordering customer, remitter, sender, 'by order of', debtor, 'from' account holder — NOT the bank name)",
  "beneficiary_name": "string or null (the company receiving the money)",
  "payment_reference": "string or null (remittance information / details of payment / 'reference for beneficiary' free text, verbatim)",
  "references": ["every document identifier mentioned anywhere: invoice numbers, order numbers, PO numbers, proforma numbers, contract numbers — verbatim strings"],
  "notes": "string or null (brief summary of the transfer, sender/receiver info)"
}

Rules:
- Return only the JSON object, no markdown fences or extra text
- For amounts, return the numeric value only (no currency symbols, no thousands separators). Use the transferred amount, not fees, charges or account balances
- For dates, convert to YYYY-MM-DD format
- payer_name is the paying CLIENT company, never the bank. Ignore bank names (Santander, BNP, HSBC, ...) unless the bank IS the ordering party
- references must be an array of strings (empty array if none). Include identifiers found in the payment reference / remittance text
- If a field cannot be determined, use null
- For notes, summarize key details like sender, receiver, bank names (max 200 chars)`;

function getMediaType(originalname: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = originalname.toLowerCase().slice(originalname.lastIndexOf('.'));
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function extractWithClaude(file: Express.Multer.File): Promise<{ data: Record<string, any>; rawText: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const client = new Anthropic({ apiKey });
  const isPdf = file.originalname.toLowerCase().endsWith('.pdf');

  let response;
  let rawText = '';

  if (isPdf) {
    let text = '';
    try {
      const textResult = await (pdfParse as any)(file.buffer);
      text = (textResult.text || '').slice(0, 8000);
    } catch (pdfErr) {
      console.warn('PDF text extraction failed:', pdfErr);
      text = `[PDF file: ${file.originalname}, size: ${file.size} bytes. Text extraction failed.]`;
    }
    // Kept so the matcher can look for customer names / document numbers that the
    // model did not surface as a discrete field.
    rawText = text.slice(0, 4000);

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
  let jsonText = textBlock.text.trim();
  const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  return { data: JSON.parse(jsonText), rawText };
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

    const { data: extracted, rawText } = await extractWithClaude(req.file);

    const references = Array.isArray(extracted.references)
      ? extracted.references.map((r: any) => String(r).trim()).filter(Boolean)
      : [];

    const result = {
      amount: extracted.amount != null && !Number.isNaN(Number(extracted.amount)) ? Number(extracted.amount) : null,
      currency: extracted.currency ? String(extracted.currency).toUpperCase().slice(0, 3) : null,
      transfer_date: extracted.transfer_date || null,
      bank_reference: extracted.bank_reference || null,
      payer_name: extracted.payer_name || null,
      beneficiary_name: extracted.beneficiary_name || null,
      payment_reference: extracted.payment_reference || null,
      references,
      notes: extracted.notes || null,
      raw_text: rawText || null,
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
