import { createHash, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "EAJ",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

export function verifyTotp(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: "EAJ",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: token.replace(/\s/g, ""), window: 1 });
  return delta !== null;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 bytes ≈ 80 bits of entropy per code
    codes.push(randomBytes(10).toString("hex"));
  }
  return codes;
}

export function hashRecoveryCodes(codes: string[]): string {
  return createHash("sha256")
    .update(codes.map((c) => c.toLowerCase()).sort().join("|"))
    .digest("hex");
}

export function recoveryCodeMatches(storedHash: string, codesLeft: string[], code: string): boolean {
  const normalized = code.toLowerCase().replace(/\s/g, "");
  if (!codesLeft.includes(normalized)) return false;
  return true;
}
