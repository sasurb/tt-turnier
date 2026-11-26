import { expect, it } from 'vitest';
import { Api } from './api';

it.each([[undefined, 3194], [17, 3403]])('K6: verwendet die angekündigte Schwierigkeit %s', async (bits, nonce) => {
  const aufgabe = 'K6-Testaufgabe-165';
  const api = new Api('http://test.invalid/', async (url, init) => {
    if (new URL(url).searchParams.get('r') === 'registrieraufgabe') {
      return Response.json({ aufgabe, bits });
    }
    expect(JSON.parse(String(init.body))).toMatchObject({ aufgabe, nonce });
    return Response.json({ ok: true });
  });

  await expect(api.registrierlink('test@example.org', null, '')).resolves.toEqual({ ok: true });
});
