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

const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
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

// Operation / NCO documents: also Word, Excel, CSV and text (served as downloads, never inline)
const operationDocExtensions = [...allowedExtensions, '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];
const operationDocFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (operationDocExtensions.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
  else cb(new Error('Only PDF, images, Word, Excel, CSV and text files are allowed'));
};

export const uploadOperationDoc = multer({
  storage: createStorage('operation-docs'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: operationDocFileFilter,
});

export const uploadOrder = multer({
  storage: createStorage('orders'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

// The document library also holds Word files (declarations)
const libraryExtensions = [...allowedExtensions, '.doc', '.docx'];
const libraryFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (libraryExtensions.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
  else cb(new Error('Only PDF, Word, JPEG, PNG and WebP files are allowed'));
};

export const uploadProductDoc = multer({
  storage: createStorage('product-docs'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: libraryFileFilter,
});

// Supplier documents (certificates, contracts, specs) — PDF, images or Word
export const uploadSupplierDoc = multer({
  storage: createStorage('supplier-docs'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: libraryFileFilter,
});
