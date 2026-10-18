import { describe, it, expect } from 'vitest'
import { relaySocketUrl } from './provider.js'

describe('relaySocketUrl', () => {
  it('uses wss:// for an https:// relay, so every browser accepts the address', () => {
    expect(relaySocketUrl('https://relay.example.workers.dev', 'abc123')).toBe('wss://relay.example.workers.dev/room/abc123')
  })

  it('uses ws:// for a local http:// relay', () => {
    expect(relaySocketUrl('http://localhost:8787', 'abc123')).toBe('ws://localhost:8787/room/abc123')
  })

  it('drops a trailing slash on the relay address', () => {
    expect(relaySocketUrl('https://relay.example.workers.dev/', 'abc123')).toBe('wss://relay.example.workers.dev/room/abc123')
  })
})
