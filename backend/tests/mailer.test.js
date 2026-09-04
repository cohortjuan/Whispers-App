import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

const { sendMail } = await import('../src/lib/mailer.js');

// mirrors password.test.js's isPasswordBreached suite: fail-open behavior
// (never throws, regardless of whether SMTP is configured or the send
// itself fails) is the thing actually being guaranteed here, matching the
// same philosophy documented in lib/password.js
describe('sendMail', () => {
  const originalSmtpHost = process.env.SMTP_HOST;

  beforeEach(() => {
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalSmtpHost;
  });

  it('fails open (resolves without sending) when SMTP_HOST is not configured', async () => {
    await expect(sendMail({ to: 'a@example.com', subject: 'hi', text: 'hello' })).resolves.toBeUndefined();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends through the configured transport when SMTP_HOST is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    sendMailMock.mockResolvedValue({});

    await sendMail({ to: 'a@example.com', subject: 'hi', text: 'hello' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.com', subject: 'hi', text: 'hello' })
    );
  });

  it('fails open (does not throw) when the transport itself rejects', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    sendMailMock.mockRejectedValue(new Error('smtp down'));

    await expect(sendMail({ to: 'a@example.com', subject: 'hi', text: 'hello' })).resolves.toBeUndefined();
  });
});
