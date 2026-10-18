import { describe, it, expect } from 'vitest'
import { waitAtMost, stageMessage } from './stage.js'

describe('waitAtMost', () => {
  it('passes the value through when the promise settles in time', async () => {
    await expect(waitAtMost(Promise.resolve(7), 1000)).resolves.toBe(7)
  })

  it('rejects when the promise never settles', async () => {
    await expect(waitAtMost(new Promise(() => {}), 5)).rejects.toThrow('timed out')
  })

  it('passes a rejection through', async () => {
    await expect(waitAtMost(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
  })
})

describe('stageMessage', () => {
  it('names each step, and says when storage did not respond', () => {
    expect(stageMessage('storage')).toMatch(/Opening this browser's storage/)
    expect(stageMessage('storage', { storageTimedOut: true })).toMatch(/isn't responding/)
    expect(stageMessage('socket')).toMatch(/Reaching the family relay/)
    expect(stageMessage('handshake')).toMatch(/family's data/)
  })

  it('adds the last close code and attempt count once an attempt has ended', () => {
    expect(stageMessage('socket', { errorCode: 1006, attempts: 1 })).toMatch(/code 1006\./)
    expect(stageMessage('socket', { errorCode: 1006, attempts: 3 })).toMatch(/code 1006 \(3 attempts so far\)/)
    expect(stageMessage('socket', { errorCode: null, attempts: 0 })).toBe('Reaching the family relay…')
  })

  it('is empty once synced, or when no step is known', () => {
    expect(stageMessage('synced')).toBe('')
    expect(stageMessage(null)).toBe('')
  })
})
