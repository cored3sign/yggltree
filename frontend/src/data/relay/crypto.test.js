import { describe, it, expect } from 'vitest'
import { newFamilyKey, encryptBytes, decryptBytes, KEY_BYTES } from './crypto.js'

// XChaCha20-Poly1305 uses a 24-byte nonce, and the blob is nonce followed by ciphertext (with its 16-byte tag).
const NONCE_BYTES = 24
const message = new TextEncoder().encode('Dentist on Tuesday at 4pm')

function flipByte(bytes, index) {
  const copy = new Uint8Array(bytes)
  copy[index] ^= 0x01
  return copy
}

describe('family key', () => {
  it('is 32 random bytes, and each call makes a new key', () => {
    const a = newFamilyKey()
    const b = newFamilyKey()
    expect(a.length).toBe(KEY_BYTES)
    expect(a).not.toEqual(b)
  })
})

describe('encryptBytes and decryptBytes', () => {
  it('round-trips a message with the same key', () => {
    const key = newFamilyKey()
    expect(decryptBytes(key, encryptBytes(key, message))).toEqual(message)
  })

  it('does not contain the plaintext in the output', () => {
    const key = newFamilyKey()
    const blob = encryptBytes(key, message)
    expect(Buffer.from(blob).toString('latin1')).not.toContain('Dentist')
  })

  it('rejects a different key', () => {
    const blob = encryptBytes(newFamilyKey(), message)
    expect(decryptBytes(newFamilyKey(), blob)).toBeNull()
  })

  it('rejects a changed ciphertext byte', () => {
    const key = newFamilyKey()
    const blob = encryptBytes(key, message)
    expect(decryptBytes(key, flipByte(blob, NONCE_BYTES))).toBeNull()
  })

  it('rejects a changed authentication tag byte', () => {
    const key = newFamilyKey()
    const blob = encryptBytes(key, message)
    expect(decryptBytes(key, flipByte(blob, blob.length - 1))).toBeNull()
  })

  it('rejects a changed nonce byte', () => {
    const key = newFamilyKey()
    const blob = encryptBytes(key, message)
    expect(decryptBytes(key, flipByte(blob, 0))).toBeNull()
  })

  it('rejects a truncated blob, and one too short to hold a nonce', () => {
    const key = newFamilyKey()
    const blob = encryptBytes(key, message)
    expect(decryptBytes(key, blob.subarray(0, blob.length - 1))).toBeNull()
    expect(decryptBytes(key, blob.subarray(0, 10))).toBeNull()
  })

  it('uses a fresh nonce each time, so the same message encrypts differently', () => {
    const key = newFamilyKey()
    const first = encryptBytes(key, message)
    const second = encryptBytes(key, message)
    expect(first.subarray(0, NONCE_BYTES)).not.toEqual(second.subarray(0, NONCE_BYTES))
    expect(first).not.toEqual(second)
    expect(decryptBytes(key, second)).toEqual(message)
  })
})
