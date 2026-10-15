import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidMessage, parsePost } from './parsePost'

test('trims whitespace and keeps text', () => {
  assert.deepEqual(parsePost('  hi  '), { ok: true, content: 'hi' })
})

test('rejects empty and whitespace-only', () => {
  assert.deepEqual(parsePost(''), { ok: false, code: 'EMPTY' })
  assert.deepEqual(parsePost(' \n\t '), { ok: false, code: 'EMPTY' })
})

test('rejects text that is only invisible characters', () => {
  assert.deepEqual(parsePost('​​﻿'), { ok: false, code: 'EMPTY' })
})

test('collapses runs of blank lines', () => {
  assert.deepEqual(parsePost('a\n\n\n\nb'), { ok: true, content: 'a\n\nb' })
})

test('limits length to 500 characters', () => {
  assert.equal(parsePost('a'.repeat(500)).ok, true)
  assert.deepEqual(parsePost('a'.repeat(501)), { ok: false, code: 'TOO_LONG' })
})

test('does not touch HTML (it is only ever shown as text)', () => {
  assert.deepEqual(parsePost('<b>x</b>'), { ok: true, content: '<b>x</b>' })
})

test('isValidMessage accepts a well-formed message', () => {
  const m = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    authorId: 'a',
    nickname: 'n',
    content: 'hi',
    createdAt: '2026-10-15T10:00:00Z',
  }
  assert.equal(isValidMessage(m), true)
})

test('isValidMessage rejects malformed messages', () => {
  const ok = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    authorId: 'a',
    nickname: 'n',
    content: 'hi',
    createdAt: '2026-10-15T10:00:00Z',
  }
  assert.equal(isValidMessage(null), false)
  assert.equal(isValidMessage({ ...ok, id: 'not-a-uuid' }), false)
  assert.equal(isValidMessage({ ...ok, content: '' }), false)
  assert.equal(isValidMessage({ ...ok, content: 'a'.repeat(501) }), false)
  assert.equal(isValidMessage({ ...ok, content: 42 }), false)
  assert.equal(isValidMessage({ ...ok, createdAt: 'yesterday' }), false)
})