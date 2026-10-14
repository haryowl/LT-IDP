import { describe, expect, it } from 'vitest';
import { isSparingAlreadyAcceptedResponse } from './sparingResponsePolicy';

describe('isSparingAlreadyAcceptedResponse', () => {
  it('detects KLHK Indonesian duplicate / already-sent messages', () => {
    expect(
      isSparingAlreadyAcceptedResponse(
        'Seluruh data yang dikirim gagal disimpan dikarenakan terdapat duplikasi data atau data sudah terkirim.'
      )
    ).toBe(true);
    expect(isSparingAlreadyAcceptedResponse('Data sudah terkirim sebelumnya')).toBe(true);
  });

  it('detects English duplicate phrasing', () => {
    expect(isSparingAlreadyAcceptedResponse('Duplicate data')).toBe(true);
    expect(isSparingAlreadyAcceptedResponse('Record already sent')).toBe(true);
  });

  it('does not treat other failures as accepted', () => {
    expect(isSparingAlreadyAcceptedResponse('Unauthorized')).toBe(false);
    expect(isSparingAlreadyAcceptedResponse('Invalid token')).toBe(false);
    expect(isSparingAlreadyAcceptedResponse(null)).toBe(false);
    expect(isSparingAlreadyAcceptedResponse('')).toBe(false);
  });
});
