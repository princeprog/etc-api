import {
  buildUploadSessionToken,
  hashUploadToken,
  isAllowedFinancingDocument,
  normalizeContactNumber,
  verifyUploadSessionToken,
} from './financing.helpers';

describe('financing helpers', () => {
  it('hashes upload tokens without returning the raw token', () => {
    expect(hashUploadToken('raw-token')).toHaveLength(64);
    expect(hashUploadToken('raw-token')).toBe(hashUploadToken('raw-token'));
    expect(hashUploadToken('other-token')).not.toBe(hashUploadToken('raw-token'));
  });

  it('normalizes contact numbers to digits only', () => {
    expect(normalizeContactNumber('+63 917-123-4567')).toBe('639171234567');
  });

  it('accepts only configured financing document file types and size', () => {
    expect(
      isAllowedFinancingDocument({
        mimeType: 'application/pdf',
        size: 10 * 1024 * 1024,
      }),
    ).toBe(true);
    expect(
      isAllowedFinancingDocument({
        mimeType: 'application/pdf',
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
    expect(
      isAllowedFinancingDocument({
        mimeType: 'application/x-msdownload',
        size: 1024,
      }),
    ).toBe(false);
  });

  it('signs and verifies upload sessions for one application', () => {
    const token = buildUploadSessionToken({
      applicationId: 'app-1',
      uploadLinkId: 'link-1',
      secret: 'test-secret',
      ttlMinutes: 30,
    });

    expect(
      verifyUploadSessionToken(token, {
        secret: 'test-secret',
        applicationId: 'app-1',
      }),
    ).toEqual({ applicationId: 'app-1', uploadLinkId: 'link-1' });
    expect(
      verifyUploadSessionToken(token, {
        secret: 'test-secret',
        applicationId: 'app-2',
      }),
    ).toBeNull();
  });
});
