const VERSION = "v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  const buffer = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

async function encryptionKey(secret: string, usages: KeyUsage[]) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

export async function encryptCredential(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret, ["encrypt"]),
    encoder.encode(value),
  );

  return [VERSION, encode(iv), encode(new Uint8Array(encrypted))].join(".");
}

export async function decryptCredential(value: string, secret: string) {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== VERSION || !ivValue || !encryptedValue) {
    throw new Error("Unsupported encrypted credential format");
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(ivValue) },
    await encryptionKey(secret, ["decrypt"]),
    decode(encryptedValue),
  );
  return decoder.decode(decrypted);
}
