/*
 * Pure CRX3 binary parser and cryptographic signature verifier.
 * Follows Chromium's components/crx_file/crx3.proto and crx_verifier.cc:
 *   - Magic: "Cr24", version: uint32LE(3), headerSize: uint32LE
 *   - Protobuf CrxFileHeader containing sha256_with_rsa (tag 2),
 *     sha256_with_ecdsa (tag 3), and signed_header_data (tag 10000)
 *   - Signed payload: "CRX3 SignedData\0" + uint32LE(signed_header_data.length)
 *     + signed_header_data + zipBytes
 *   - Verifies both extension ID derivation (sha256(public_key)[0..16] -> a..p)
 *     and cryptographic RSA/ECDSA SHA-256 signature over the header + ZIP archive.
 */
import { createHash, createPublicKey, createVerify } from 'node:crypto'

const CRX3_MAGIC = 'Cr24'
const CRX3_VERSION = 3
const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'ascii')

export interface CrxKeyProof {
  algorithm: 'rsa' | 'ecdsa'
  publicKey: Uint8Array
  signature: Uint8Array
}

export interface VerifiedCrx3 {
  extensionId: string
  publicKey: Uint8Array
  publicKeyBase64: string
  zipBytes: Uint8Array
}

function bytesToExtensionId(first16: Uint8Array): string {
  let out = ''
  for (let i = 0; i < 16; i++) {
    const b = first16[i]
    out += String.fromCharCode(97 + ((b >> 4) & 0x0f))
    out += String.fromCharCode(97 + (b & 0x0f))
  }
  return out
}

export function deriveExtensionIdFromPublicKey(publicKeyDer: Uint8Array): string {
  const hash = createHash('sha256').update(publicKeyDer).digest()
  return bytesToExtensionId(hash.subarray(0, 16))
}

interface ProtoReader {
  buf: Uint8Array
  pos: number
  end: number
}

function readVarint(r: ProtoReader): number {
  let result = 0
  let shift = 0
  for (let i = 0; i < 10; i++) {
    if (r.pos >= r.end) throw new Error('Unexpected EOF in protobuf varint')
    const byte = r.buf[r.pos++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return result
    shift += 7
  }
  throw new Error('Malformed protobuf varint')
}

function readLengthDelimited(r: ProtoReader): Uint8Array {
  const len = readVarint(r)
  if (!Number.isSafeInteger(len) || len < 0 || r.pos + len > r.end) {
    throw new Error('Invalid protobuf length-delimited field')
  }
  const slice = r.buf.subarray(r.pos, r.pos + len)
  r.pos += len
  return slice
}

function skipField(r: ProtoReader, wireType: number): void {
  if (wireType === 0) {
    readVarint(r)
  } else if (wireType === 1) {
    if (r.pos + 8 > r.end) throw new Error('Unexpected EOF skipping fixed64')
    r.pos += 8
  } else if (wireType === 2) {
    readLengthDelimited(r)
  } else if (wireType === 5) {
    if (r.pos + 4 > r.end) throw new Error('Unexpected EOF skipping fixed32')
    r.pos += 4
  } else {
    throw new Error(`Unsupported protobuf wire type ${wireType}`)
  }
}

function parseKeyProof(bytes: Uint8Array, algorithm: 'rsa' | 'ecdsa'): CrxKeyProof {
  const r: ProtoReader = { buf: bytes, pos: 0, end: bytes.length }
  let publicKey: Uint8Array | null = null
  let signature: Uint8Array | null = null
  while (r.pos < r.end) {
    const key = readVarint(r)
    const fieldNumber = Math.floor(key / 8)
    const wireType = key & 7
    if (fieldNumber === 1 && wireType === 2) {
      publicKey = readLengthDelimited(r)
    } else if (fieldNumber === 2 && wireType === 2) {
      signature = readLengthDelimited(r)
    } else {
      skipField(r, wireType)
    }
  }
  if (!publicKey || !signature || publicKey.length === 0 || signature.length === 0) {
    throw new Error('CRX3 key proof is missing public_key or signature')
  }
  return { algorithm, publicKey, signature }
}

function parseSignedData(bytes: Uint8Array): Uint8Array {
  const r: ProtoReader = { buf: bytes, pos: 0, end: bytes.length }
  let crxId: Uint8Array | null = null
  while (r.pos < r.end) {
    const key = readVarint(r)
    const fieldNumber = Math.floor(key / 8)
    const wireType = key & 7
    if (fieldNumber === 1 && wireType === 2) {
      crxId = readLengthDelimited(r)
    } else {
      skipField(r, wireType)
    }
  }
  if (!crxId || crxId.length !== 16) {
    throw new Error('CRX3 signed_header_data is missing a valid 16-byte crx_id')
  }
  return crxId
}

function parseCrxFileHeader(headerBytes: Uint8Array): {
  proofs: CrxKeyProof[]
  signedHeaderData: Uint8Array
} {
  const r: ProtoReader = { buf: headerBytes, pos: 0, end: headerBytes.length }
  const proofs: CrxKeyProof[] = []
  let signedHeaderData: Uint8Array | null = null

  while (r.pos < r.end) {
    const key = readVarint(r)
    const fieldNumber = Math.floor(key / 8)
    const wireType = key & 7
    if (fieldNumber === 2 && wireType === 2) {
      proofs.push(parseKeyProof(readLengthDelimited(r), 'rsa'))
    } else if (fieldNumber === 3 && wireType === 2) {
      proofs.push(parseKeyProof(readLengthDelimited(r), 'ecdsa'))
    } else if (fieldNumber === 10000 && wireType === 2) {
      signedHeaderData = readLengthDelimited(r)
    } else {
      skipField(r, wireType)
    }
  }

  if (!signedHeaderData || signedHeaderData.length === 0) {
    throw new Error('CRX3 header is missing signed_header_data')
  }
  if (proofs.length === 0) {
    throw new Error('CRX3 header contains no cryptographic proofs')
  }
  return { proofs, signedHeaderData }
}

function verifyProofSignature(
  proof: CrxKeyProof,
  signedHeaderData: Uint8Array,
  zipBytes: Uint8Array
): boolean {
  try {
    const keyObj = createPublicKey({
      key: Buffer.from(proof.publicKey),
      format: 'der',
      type: 'spki'
    })
    if (proof.algorithm === 'rsa' && keyObj.asymmetricKeyType !== 'rsa') return false
    if (proof.algorithm === 'ecdsa' && keyObj.asymmetricKeyType !== 'ec') return false

    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32LE(signedHeaderData.length, 0)

    const verifier = createVerify('SHA256')
    verifier.update(CRX3_SIGNED_DATA_PREFIX)
    verifier.update(lenBuf)
    verifier.update(signedHeaderData)
    verifier.update(zipBytes)
    verifier.end()
    return verifier.verify(keyObj, proof.signature)
  } catch {
    return false
  }
}

/**
 * Parses a CRX3 buffer and cryptographically verifies its publisher signature
 * over `signed_header_data` + ZIP archive bytes.
 *
 * Throws on CRX2, malformed headers, missing proofs, mismatched extension ID,
 * or invalid signature.
 */
export function parseAndVerifyCrx3(rawBuffer: Uint8Array, expectedExtensionId?: string): VerifiedCrx3 {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer)
  if (buf.length < 12) {
    throw new Error('Invalid CRX3 file: too short')
  }
  if (buf.subarray(0, 4).toString('ascii') !== CRX3_MAGIC) {
    throw new Error('Invalid CRX3 file: bad magic header')
  }
  const version = buf.readUInt32LE(4)
  if (version !== CRX3_VERSION) {
    throw new Error(`Unsupported CRX version ${version} (CRX3 required)`)
  }
  const headerSize = buf.readUInt32LE(8)
  if (headerSize === 0 || 12 + headerSize >= buf.length) {
    throw new Error('Invalid CRX3 file: invalid header size')
  }

  const headerBytes = buf.subarray(12, 12 + headerSize)
  const zipBytes = buf.subarray(12 + headerSize)

  const { proofs, signedHeaderData } = parseCrxFileHeader(headerBytes)
  const crxIdBytes = parseSignedData(signedHeaderData)
  const declaredId = bytesToExtensionId(crxIdBytes)

  if (expectedExtensionId && expectedExtensionId !== declaredId) {
    throw new Error(`CRX3 extension ID mismatch: expected ${expectedExtensionId}, got ${declaredId}`)
  }

  // Every declared proof matching the extension's publisher ID must verify, and
  // at least one matching publisher proof must be present and valid.
  const matchingProofs = proofs.filter((p) => deriveExtensionIdFromPublicKey(p.publicKey) === declaredId)
  if (matchingProofs.length === 0) {
    throw new Error('CRX3 header has no public key matching declared extension ID')
  }

  for (const proof of matchingProofs) {
    if (!verifyProofSignature(proof, signedHeaderData, zipBytes)) {
      throw new Error('CRX3 cryptographic signature verification failed')
    }
  }

  const primaryKey = matchingProofs[0].publicKey
  return {
    extensionId: declaredId,
    publicKey: primaryKey,
    publicKeyBase64: Buffer.from(primaryKey).toString('base64'),
    zipBytes
  }
}

// ---- Minimal protobuf encoder for unit tests -------------------------------

function encodeVarint(val: number): number[] {
  const out: number[] = []
  let v = val >>> 0
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
  return out
}

function encodeLengthDelimited(fieldNumber: number, payload: Uint8Array): Buffer {
  const tag = encodeVarint(fieldNumber * 8 + 2)
  const len = encodeVarint(payload.length)
  return Buffer.concat([Buffer.from(tag), Buffer.from(len), Buffer.from(payload)])
}

/**
 * Builds a valid CRX3 buffer from a DER SPKI public key, signature over
 * CRX3 SignedData, and ZIP bytes. Exported for deterministic unit testing.
 */
export function buildCrx3Buffer(opts: {
  algorithm: 'rsa' | 'ecdsa'
  publicKeyDer: Uint8Array
  sign: (data: Buffer) => Uint8Array
  zipBytes: Uint8Array
}): Buffer {
  const crxId = createHash('sha256').update(opts.publicKeyDer).digest().subarray(0, 16)
  const signedHeaderData = encodeLengthDelimited(1, crxId)

  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32LE(signedHeaderData.length, 0)
  const toSign = Buffer.concat([CRX3_SIGNED_DATA_PREFIX, lenBuf, signedHeaderData, Buffer.from(opts.zipBytes)])
  const signature = opts.sign(toSign)

  const keyProof = Buffer.concat([
    encodeLengthDelimited(1, opts.publicKeyDer),
    encodeLengthDelimited(2, signature)
  ])
  const proofField = opts.algorithm === 'rsa' ? 2 : 3
  const header = Buffer.concat([
    encodeLengthDelimited(proofField, keyProof),
    encodeLengthDelimited(10000, signedHeaderData)
  ])

  const prelude = Buffer.alloc(12)
  prelude.write(CRX3_MAGIC, 0, 4, 'ascii')
  prelude.writeUInt32LE(CRX3_VERSION, 4)
  prelude.writeUInt32LE(header.length, 8)
  return Buffer.concat([prelude, header, Buffer.from(opts.zipBytes)])
}
