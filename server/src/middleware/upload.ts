import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadsBase = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads');

function createStorage(subfolder: string) {
  const uploadDir = path.join(uploadsBase, subfolder);
  fs.mkdirSync(uploadDir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      cb(null, name);
    },
  });
}

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPEG, PNG, and WebP files are allowed'));
  }
};

export const uploadInvoice = multer({
  storage: createStorage('invoices'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

export const uploadPayment = multer({
  storage: createStorage('payments'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

export const uploadWireTransfer = multer({
  storage: createStorage('wire-transfers'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

export const uploadOperationDoc = multer({
  storage: createStorage('operation-docs'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

export const uploadOrder = multer({
  storage: createStorage('orders'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});
