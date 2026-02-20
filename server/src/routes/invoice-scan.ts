import { Router, Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { PDFParse } from 'pdf-parse';
import db from '../database.js';

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

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Analyze the provided invoice and extract the following fields. Return ONLY valid JSON with no extra text.

{
  "invoice_number": "string or null",
  "amount": "number or null (total amount due)",
  "currency": "string or null (3-letter ISO code like USD, EUR, GBP)",
  "invoice_date": "string or null (YYYY-MM-DD format, the date the invoice was issued)",
  "due_date": "string or null (YYYY-MM-DD format)",
  "vendor_or_customer_name": "string or null (the company/person who issued or received the invoice)",
  "po_number": "string or null (PO number, purchase order number, or order reference, if present)",
  "notes": "string or null (brief summary of line items or purpose)"
}

Rules:
- Return only the JSON object, no markdown fences or extra text
- For amounts, return the numeric value only (no currency symbols)
- For dates, convert to YYYY-MM-DD format
- If a field cannot be determined, use null
- For notes, summarize the main line items or purpose briefly (max 200 chars)`;

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
      console.warn('PDF text extraction failed, sending minimal info to Claude:', pdfErr);
      text = `[PDF file: ${file.originalname}, size: ${file.size} bytes. Text extraction failed. Please extract what you can.]`;
    }

    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\nInvoice text content:\n${text}`,
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

  // Strip markdown code fences that Claude sometimes wraps around JSON
  let rawText = textBlock.text.trim();
  const fenceMatch = rawText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    rawText = fenceMatch[1].trim();
  }

  return JSON.parse(rawText);
}

function fuzzyMatchEntity(name: string): { customer_id?: number; supplier_id?: number; type?: string } {
  if (!name) return {};

  const searchTerm = `%${name}%`;

  const customer = db.prepare(
    `SELECT id FROM customers WHERE name LIKE ? LIMIT 1`
  ).get(searchTerm) as any;

  if (customer) {
    return { customer_id: customer.id, type: 'customer' };
  }

  const supplier = db.prepare(
    `SELECT id FROM suppliers WHERE name LIKE ? LIMIT 1`
  ).get(searchTerm) as any;

  if (supplier) {
    return { supplier_id: supplier.id, type: 'supplier' };
  }

  return {};
}

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(501).json({ error: 'Invoice scanning is not configured (missing API key)' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const extracted = await extractWithClaude(req.file);

    const entityMatch = fuzzyMatchEntity(extracted.vendor_or_customer_name);

    const result = {
      invoice_number: extracted.invoice_number || null,
      amount: extracted.amount != null ? Number(extracted.amount) : null,
      currency: extracted.currency || null,
      invoice_date: extracted.invoice_date || null,
      due_date: extracted.due_date || null,
      po_number: extracted.po_number || null,
      notes: extracted.notes || null,
      vendor_or_customer_name: extracted.vendor_or_customer_name || null,
      ...entityMatch,
    };

    res.json(result);
  } catch (err: any) {
    if (err.message === 'NO_API_KEY') {
      res.status(501).json({ error: 'Invoice scanning is not configured' });
      return;
    }
    console.error('Invoice scan error:', err.message || err);
    res.status(500).json({ error: `Failed to scan invoice: ${err.message || 'Unknown error'}` });
  }
});

export default router;
