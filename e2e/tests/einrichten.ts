import type { FullConfig } from '@playwright/test';

export const ADMIN = { email: 'admin@example.org', passwort: 'admin-passwort-1' };

/** Legt einmal den Administrator an (frischer Server je Testlauf). */
export default async function einrichten(config: FullConfig) {
  const basis = config.projects[0]!.use.baseURL!;
  const info = await (await fetch(`${basis}api/index.php?r=info`)).json();
  if (!info.eingerichtet) {
    const r = await fetch(`${basis}api/index.php?r=setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'e2e-einrichtung-123', name: 'Sascha Admin', ...ADMIN }),
    });
    if (!r.ok) throw new Error('Einrichtung fehlgeschlagen: ' + (await r.text()));
  }
}
