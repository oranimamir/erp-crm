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

const EXTRACTION_PROMPT = `You are an order document extraction assistant. Analyze the provided purchase order or sales order document and extract the following fields. Return ONLY valid JSON with no extra text or markdown fences.

{
  "order_number": "string or null",
  "customer_or_supplier_name": "string or null (the company name of the buyer or seller)",
  "order_date": "string or null (YYYY-MM-DD format)",
  "items": [
    {
      "product_name": "string (name of the product ordered)",
      "quantity": "number",
      "unit": "string (use 'tons' for metric tons, 'kg' for kilograms, 'lbs' for pounds — default to 'tons' if unclear)",
      "unit_price": "number or null"
    }
  ],
  "notes": "string or null (any relevant notes or special instructions)"
}

Rules:
- Return only the JSON object, no markdown fences or extra text
- For quantities, return the numeric value only
- If items cannot be determined, return an empty array
- For units, only use: tons, kg, or lbs`;

function getMediaType(originalname: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = originalname.toLowerCase().slice(originalname.lastIndexOf('.'));
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function extractWithClaude(file: Express.Multer.File): Promise<Record<string, any>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('NO_API_KEY');

  const client = new Anthropic({ apiKey });
  const isPdf = file.originalname.toLowerCase().endsWith('.pdf');
  let response;

  if (isPdf) {
    let text = '';
    try {
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      const textResult = await parser.getText();
      text = textResult.text.slice(0, 8000);
    } catch {
      text = `[PDF file: ${file.originalname}, size: ${file.size} bytes. Text extraction failed.]`;
    }
    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nOrder document text:\n${text}` }],
    });
  } else {
    const base64 = file.buffer.toString('base64');
    const mediaType = getMediaType(file.originalname);
    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    });
  }

  const textBlock = response.content.find((b: any) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  let rawText = textBlock.text.trim();
  const fenceMatch = rawText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) rawText = fenceMatch[1].trim();

  return JSON.parse(rawText);
}

function fuzzyMatchEntity(name: string): { customer_id?: number; supplier_id?: number; type?: string } {
  if (!name) return {};
  const term = `%${name}%`;
  const customer = db.prepare('SELECT id FROM customers WHERE name LIKE ? LIMIT 1').get(term) as any;
  if (customer) return { customer_id: customer.id, type: 'customer' };
  const supplier = db.prepare('SELECT id FROM suppliers WHERE name LIKE ? LIMIT 1').get(term) as any;
  if (supplier) return { supplier_id: supplier.id, type: 'supplier' };
  return {};
}

function fuzzyMatchProduct(name: string): { product_id?: number; description: string } {
  if (!name) return { description: name };
  const term = `%${name}%`;
  const product = db.prepare('SELECT id, name FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 1').get(term, term) as any;
  if (product) return { product_id: product.id, description: product.name };
  return { description: name };
}

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(501).json({ error: 'Order scanning is not configured (missing API key)' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const extracted = await extractWithClaude(req.file);
    const entityMatch = fuzzyMatchEntity(extracted.customer_or_supplier_name || '');

    const items = Array.isArray(extracted.items)
      ? extracted.items.map((item: any) => ({
          ...fuzzyMatchProduct(item.product_name || ''),
          quantity: item.quantity != null ? Number(item.quantity) : 1,
          unit: ['tons', 'kg', 'lbs'].includes(item.unit) ? item.unit : 'tons',
          unit_price: item.unit_price != null ? Number(item.unit_price) : 0,
        }))
      : [];

    res.json({
      order_number: extracted.order_number || null,
      notes: extracted.notes || null,
      ...entityMatch,
      items,
    });
  } catch (err: any) {
    if (err.message === 'NO_API_KEY') {
      res.status(501).json({ error: 'Order scanning is not configured' });
      return;
    }
    console.error('Order scan error:', err.message || err);
    res.status(500).json({ error: `Failed to scan order: ${err.message || 'Unknown error'}` });
  }
});

export default router;
