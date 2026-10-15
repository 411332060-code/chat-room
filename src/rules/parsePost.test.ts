import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePost } from './parsePost'

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
