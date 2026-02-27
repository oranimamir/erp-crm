import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseAndInsertStockCsv } from './parse-stock-csv.js';

export function isEmailStockConfigured(): boolean {
  return !!(process.env.STOCK_EMAIL_USER && process.env.STOCK_EMAIL_PASS);
}

export async function checkEmailForStockUpdates(): Promise<void> {
  if (!isEmailStockConfigured()) return;

  const client = new ImapFlow({
    host:   process.env.STOCK_EMAIL_HOST || 'imap.gmail.com',
    port:   parseInt(process.env.STOCK_EMAIL_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.STOCK_EMAIL_USER!,
      pass: process.env.STOCK_EMAIL_PASS!,
    },
    logger: false, // suppress verbose imap logs
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    // Fetch all unseen messages
    const uids: number[] = [];
    for await (const msg of client.fetch('UNSEEN', { uid: true, envelope: true })) {
      uids.push(msg.uid);
    }

    if (uids.length === 0) {
      await client.logout();
      return;
    }

    for (const uid of uids) {
      try {
        // Download the full message
        const { content } = await client.download(`${uid}`, undefined, { uid: true }) as any;
        const chunks: Buffer[] = [];
        for await (const chunk of content) chunks.push(chunk);
        const raw = Buffer.concat(chunks);

        const parsed = await simpleParser(raw);

        // Find first CSV attachment
        const csvAttachment = parsed.attachments?.find(
          a => a.filename?.toLowerCase().endsWith('.csv') ||
               a.contentType === 'text/csv' ||
               a.contentType === 'application/csv' ||
               a.contentType === 'application/octet-stream'
        );

        if (!csvAttachment) {
          // No CSV — mark as seen and skip
          await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
          console.log(`[Email stock] UID ${uid}: no CSV attachment, skipping`);
          continue;
        }

        const csvContent = csvAttachment.content.toString('utf-8');
        const from = parsed.from?.text || 'email';
        const filename = csvAttachment.filename || 'attachment.csv';

        const inserted = parseAndInsertStockCsv(csvContent, {
          filename,
          uploadedBy: from,
          source: 'email',
        });

        await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
        console.log(`[Email stock] UID ${uid}: imported ${inserted} rows from "${filename}" (from: ${from})`);
      } catch (err) {
        console.error(`[Email stock] UID ${uid}: failed to process —`, err);
        // Still mark as seen so we don't retry endlessly
        await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
      }
    }

    await client.logout();
  } catch (err) {
    console.error('[Email stock] IMAP connection error:', err);
    try { await client.logout(); } catch (_) {}
  }
}
