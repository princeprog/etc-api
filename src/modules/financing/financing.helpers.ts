import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

export const FINANCING_ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const FINANCING_MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
export const FINANCING_MAX_CURRENT_FILES_PER_REQUIREMENT = 5;

export function generateUploadToken() {
  return randomBytes(32).toString('base64url');
}

export function hashUploadToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeContactNumber(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
}

export function isAllowedFinancingDocument(input: {
  mimeType: string;
  size: number;
}) {
  return (
    FINANCING_ALLOWED_DOCUMENT_MIME_TYPES.includes(
      input.mimeType as (typeof FINANCING_ALLOWED_DOCUMENT_MIME_TYPES)[number],
    ) && input.size <= FINANCING_MAX_DOCUMENT_SIZE_BYTES
  );
}

export function getFinancingUploadLinkTtlDays() {
  return parseEnvPositiveInteger('FINANCING_UPLOAD_LINK_TTL_DAYS', 14);
}

export function getFinancingUploadSessionTtlMinutes() {
  return parseEnvPositiveInteger('FINANCING_UPLOAD_SESSION_TTL_MINUTES', 30);
}

export function getFinancingDocumentUrlTtlSeconds() {
  return parseEnvPositiveInteger('FINANCING_DOCUMENT_URL_TTL_SECONDS', 300);
}

export function getFinancingUploadSessionSecret() {
  return (
    process.env.FINANCING_UPLOAD_SESSION_SECRET?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'development-financing-upload-session-secret'
  );
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

type BuildUploadSessionTokenInput = {
  applicationId: string;
  uploadLinkId: string;
  secret: string;
  ttlMinutes: number;
};

export function buildUploadSessionToken(input: BuildUploadSessionTokenInput) {
  const payload = {
    applicationId: input.applicationId,
    uploadLinkId: input.uploadLinkId,
    expiresAt: addMinutes(new Date(), input.ttlMinutes).toISOString(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = sign(encodedPayload, input.secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyUploadSessionToken(
  token: string | undefined,
  input: { secret: string; applicationId?: string },
) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  if (!safeEqual(signature, sign(encodedPayload, input.secret))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as {
      applicationId?: string;
      uploadLinkId?: string;
      expiresAt?: string;
    };

    if (
      !payload.applicationId ||
      !payload.uploadLinkId ||
      !payload.expiresAt ||
      Number.isNaN(Date.parse(payload.expiresAt)) ||
      new Date(payload.expiresAt).getTime() < Date.now()
    ) {
      return null;
    }

    if (input.applicationId && payload.applicationId !== input.applicationId) {
      return null;
    }

    return {
      applicationId: payload.applicationId,
      uploadLinkId: payload.uploadLinkId,
    };
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseEnvPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
