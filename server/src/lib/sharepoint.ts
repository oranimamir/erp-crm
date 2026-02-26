import db from '../database.js';

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || '';
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || '';
const SITE_HOST = '3plw.sharepoint.com';
const SITE_PATH = '/sites/Productmanagement';
const OPERATIONS_FOLDER = 'General/03 - Operations (Sales orders)';

// ── Token cache ───────────────────────────────────────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token fetch failed HTTP ${response.status}: ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

// ── Site + Drive IDs (cached per process) ─────────────────────────────────────

let siteAndDriveCache: { siteId: string; driveId: string } | null = null;

async function getSiteAndDriveIds(): Promise<{ siteId: string; driveId: string }> {
  if (siteAndDriveCache) return siteAndDriveCache;

  const token = await getAccessToken();

  const siteRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SITE_HOST}:${SITE_PATH}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!siteRes.ok) throw new Error(`Site fetch failed HTTP ${siteRes.status}`);
  const site = await siteRes.json() as { id: string };

  const drivesRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!drivesRes.ok) throw new Error(`Drives fetch failed HTTP ${drivesRes.status}`);
  const drives = await drivesRes.json() as { value: { id: string; name: string }[] };

  const drive = drives.value.find(d => d.name === 'Documents') || drives.value[0];
  if (!drive) throw new Error('No drives found for SharePoint site');

  siteAndDriveCache = { siteId: site.id, driveId: drive.id };
  return siteAndDriveCache;
}

// ── File type detection ───────────────────────────────────────────────────────

function detectFileType(filename: string): 'order' | 'invoice' | 'other' {
  const lower = filename.toLowerCase();
  if (lower.includes('order') || lower.includes('po') || lower.includes('sales')) return 'order';
  if (lower.includes('invoice') || lower.includes('inv') || lower.includes('facture')) return 'invoice';
  return 'other';
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface SharePointFile {
  name: string;
  downloadUrl: string;
  type: 'order' | 'invoice' | 'other';
}

// ── List operation folders ────────────────────────────────────────────────────

export async function listOperationFolders(): Promise<{ id: string; name: string }[]> {
  const token = await getAccessToken();
  const { driveId } = await getSiteAndDriveIds();

  const encodedPath = OPERATIONS_FOLDER.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/children`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Folder list failed HTTP ${res.status}`);
  const data = await res.json() as { value: { id: string; name: string; folder?: object }[] };

  return data.value
    .filter(item => item.folder && /^SO/i.test(item.name))
    .map(item => ({ id: item.id, name: item.name }));
}

// ── List files in a folder ────────────────────────────────────────────────────

export async function listFolderFiles(folderId: string): Promise<SharePointFile[]> {
  const token = await getAccessToken();
  const { driveId } = await getSiteAndDriveIds();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`File list failed HTTP ${res.status}`);
  const data = await res.json() as {
    value: { id: string; name: string; file?: object; '@microsoft.graph.downloadUrl'?: string }[]
  };

  return data.value
    .filter(item => item.file)
    .map(item => ({
      name: item.name,
      downloadUrl: item['@microsoft.graph.downloadUrl'] || '',
      type: detectFileType(item.name),
    }));
}

// ── Download file as Buffer ───────────────────────────────────────────────────

export async function downloadFileBuffer(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`File download failed HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ── Main scan ─────────────────────────────────────────────────────────────────

export async function scanNewOperations(): Promise<{ found: number; new: number }> {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[SharePoint] Missing credentials (SHAREPOINT_TENANT_ID / CLIENT_ID / CLIENT_SECRET) — skipping scan');
    return { found: 0, new: 0 };
  }

  const folders = await listOperationFolders();
  let newCount = 0;

  for (const folder of folders) {
    // Skip if operation already exists in DB
    const existingOp = db.prepare('SELECT id FROM operations WHERE operation_number = ?').get(folder.name);
    if (existingOp) continue;

    // Skip if already pending or imported (but allow re-scan if previously ignored)
    const existingPending = db.prepare(
      "SELECT id FROM sharepoint_pending WHERE folder_name = ? AND status IN ('pending', 'imported')"
    ).get(folder.name);
    if (existingPending) continue;

    const files = await listFolderFiles(folder.id);
    db.prepare('INSERT INTO sharepoint_pending (folder_name, files) VALUES (?, ?)').run(
      folder.name,
      JSON.stringify(files)
    );
    newCount++;
  }

  console.log(`[SharePoint] Scanned ${folders.length} folders, ${newCount} new`);
  return { found: folders.length, new: newCount };
}
