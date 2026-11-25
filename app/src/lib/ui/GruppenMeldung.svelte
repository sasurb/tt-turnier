<script lang="ts">
  /**
   * Gruppenanmeldung (ab 0.18, Frage 8C): Eine volljährige Mannschaftsleitung meldet mehrere Personen – auch
   * Minderjährige, ohne deren E-Mail – für Einzel, Doppel/Mixed und Mannschaften. Alle Mails gehen an sie.
   */
  import type { AnmeldungInfo, AnmeldungKonkurrenz } from '@shared/protokoll';
  import { GRUPPE_MAX_PERSONEN } from '@shared/protokoll';
  import { T } from '../texte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';
  import { linkZu } from '../router.svelte';
  import { euro } from '../engine/modell';
  import Hilfe from './Hilfe.svelte';

  let { info, turnier, gesendet }: { info: AnmeldungInfo; turnier: string; gesendet: () => void } = $props();

  interface Person { key: number; vorname: string; nachname: string; ttr: string; klasse: string; geschlecht: string; jahrgang: string }
  interface Team { key: number; name: string; spieler: number[]; fuehrer: number; wechsler: number[] }

  let naechster = 3;
  const neuePerson = (key: number): Person => ({ key, vorname: '', nachname: '', ttr: '', klasse: '', geschlecht: '', jahrgang: '' });
  let leitung = $state({ vorname: '', nachname: '', verein: '', email: '' });
  let personen = $state<Person[]>([neuePerson(1), neuePerson(2)]);
  /** Einzelmeldungen je Konkurrenz: Schlüssel der Personen */
  // svelte-ignore state_referenced_locally
  let einzeln = $state<Record<string, number[]>>(Object.fromEntries(info.einstellungen.konkurrenzen.map((k) => [k.id, []])));
  /** Paare je Konkurrenz */
  let paare = $state<Record<string, [number | '', number | ''][]>>({});
  /** Mannschaften je Konkurrenz */
  let teams = $state<Record<string, Team[]>>({});
  let volljaehrig = $state(false);
  let eltern = $state(false);
  let datenschutz = $state(false);
  let verteiler = $state(false);
  let website = $state('');
  let fehler = $state('');
  let sendet = $state(false);

  const pflicht = $derived(new Set(info.einstellungen.angaben));
  const form = (k: AnmeldungKonkurrenz) => k.form ?? (k.art === 'einzel' ? 'einzel' : k.art === 'mannschaft' ? 'gruppe' : 'beides');
  const einzelnErlaubt = (k: AnmeldungKonkurrenz) => k.art === 'einzel' || form(k) !== 'gruppe';
  const gruppeErlaubt = (k: AnmeldungKonkurrenz) => k.art !== 'einzel' && form(k) !== 'einzel';
  const name = (key: number) => {
    const p = personen.find((x) => x.key === key);
    return p ? `${p.vorname} ${p.nachname}`.trim() || T.meldung.gruppe.person(personen.indexOf(p) + 1) : '';
  };
  const personOk = (p: Person) =>
    !!p.vorname.trim() &&
    !!p.nachname.trim() &&
    (!pflicht.has('ttr') || p.ttr.trim() !== '') &&
    (!pflicht.has('klasse') || !!p.klasse.trim()) &&
    (!pflicht.has('geschlecht') || !!p.geschlecht) &&
    (!pflicht.has('jahrgang') || /^\d{4}$/.test(p.jahrgang));

  function personWeg(key: number) {
    personen = personen.filter((p) => p.key !== key);
    for (const kid of Object.keys(einzeln)) einzeln[kid] = einzeln[kid]!.filter((x) => x !== key);
    for (const kid of Object.keys(paare)) paare[kid] = paare[kid]!.map(([a, b]) => [a === key ? '' : a, b === key ? '' : b]);
    for (const kid of Object.keys(teams))
      teams[kid] = teams[kid]!.map((t) => ({ ...t, spieler: t.spieler.filter((x) => x !== key), wechsler: t.wechsler.filter((x) => x !== key), fuehrer: t.fuehrer === key ? -1 : t.fuehrer }));
  }

  /** Meldungen für den Server (Indizes statt Schlüssel) */
  const meldungen = $derived.by(() => {
    const idx = (key: number) => personen.findIndex((p) => p.key === key);
    const aus: { konkurrenz: string; personen: number[]; name?: string; fuehrer?: number; wechsler?: number[] }[] = [];
    for (const k of info.einstellungen.konkurrenzen) {
      for (const key of einzeln[k.id] ?? []) if (idx(key) >= 0) aus.push({ konkurrenz: k.id, personen: [idx(key)] });
      for (const [a, b] of paare[k.id] ?? []) if (a !== '' && b !== '' && a !== b) aus.push({ konkurrenz: k.id, personen: [idx(a), idx(b)] });
      for (const t of teams[k.id] ?? [])
        aus.push({ konkurrenz: k.id, personen: t.spieler.map(idx).filter((x) => x >= 0), name: t.name.trim(), fuehrer: t.fuehrer === -1 ? -1 : idx(t.fuehrer), wechsler: t.wechsler.map(idx).filter((x) => x >= 0) });
    }
    return aus;
  });
  const teamsOk = $derived(
    info.einstellungen.konkurrenzen.every((k) =>
      (teams[k.id] ?? []).every((t) => !!t.name.trim() && t.spieler.length >= (k.min ?? 1) && t.spieler.length <= (k.maxSpieler ?? 20) && (t.fuehrer === -1 || t.spieler.includes(t.fuehrer))),
    ),
  );
  const vollstaendig = $derived(
    !!leitung.vorname.trim() &&
      !!leitung.nachname.trim() &&
      leitung.verein.trim().length >= 2 &&
      /.+@.+\..+/.test(leitung.email.trim()) &&
      personen.length > 0 &&
      personen.every(personOk) &&
      meldungen.length > 0 &&
      teamsOk &&
      volljaehrig &&
      eltern &&
      datenschutz,
  );

  async function senden(e: SubmitEvent) {
    e.preventDefault();
    if (!vollstaendig) {
      fehler = T.meldung.gruppe.fehlt;
      return;
    }
    sendet = true;
    fehler = '';
    const zahl = (t: string) => (t.trim() === '' ? null : Number(t));
    try {
      await api.anmeldungSenden({
        turnier,
        typ: 'gruppe',
        vorname: leitung.vorname.trim(),
        nachname: leitung.nachname.trim(),
        verein: leitung.verein.trim(),
        email: leitung.email.trim(),
        volljaehrig,
        erziehungsberechtigte: eltern,
        datenschutz,
        ...(verteiler ? { verteiler: true } : {}),
        personen: personen.map((p) => ({
          vorname: p.vorname.trim(),
          nachname: p.nachname.trim(),
          ttr: pflicht.has('ttr') ? zahl(p.ttr) : null,
          klasse: pflicht.has('klasse') ? p.klasse.trim() || null : null,
          geschlecht: pflicht.has('geschlecht') ? ((p.geschlecht || null) as 'm' | 'w' | 'd' | null) : null,
          jahrgang: pflicht.has('jahrgang') ? zahl(p.jahrgang) : null,
        })),
        meldungen,
        website,
      });
      gesendet();
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }
</script>

<form class="karte" onsubmit={senden} novalidate data-testid="gruppen-meldung">
  <h2>{T.meldung.gruppe.leitung}</h2>
  <div class="raster">
    <label>{T.meldung.vorname}<input bind:value={leitung.vorname} autocomplete="given-name" maxlength="80" /></label>
    <label>{T.meldung.nachname}<input bind:value={leitung.nachname} autocomplete="family-name" maxlength="80" /></label>
  </div>
  <label>{T.meldung.gruppe.verein}<input bind:value={leitung.verein} autocomplete="organization" maxlength="120" /></label>
  <div class="label-zeile"><label for="g-email">{T.meldung.email}</label><Hilfe text={T.meldung.emailHilfe} /></div>
  <input id="g-email" type="email" bind:value={leitung.email} autocomplete="email" maxlength="190" />

  <h2>{T.meldung.gruppe.personen} <span class="leise">({personen.length})</span><Hilfe text={T.meldung.gruppe.personenHilfe} /></h2>
  <ol class="personen">
    {#each personen as p, i (p.key)}
      <li class:unvollstaendig={!personOk(p) && (p.vorname !== '' || p.nachname !== '')}>
        <div class="reihe kopf"><strong class="wachsen">{T.meldung.gruppe.person(i + 1)}</strong>
          {#if personen.length > 1}<button type="button" class="zweit klein" onclick={() => personWeg(p.key)} aria-label="{T.meldung.gruppe.personWeg} {i + 1}">✕</button>{/if}
        </div>
        <div class="raster">
          <label>{T.meldung.vorname}<input bind:value={p.vorname} maxlength="80" autocomplete="off" data-testid="g-vorname" /></label>
          <label>{T.meldung.nachname}<input bind:value={p.nachname} maxlength="80" autocomplete="off" data-testid="g-nachname" /></label>
          {#if pflicht.has('jahrgang')}<label>{T.meldung.jahrgang}<input bind:value={p.jahrgang} inputmode="numeric" maxlength="4" data-testid="g-jahrgang" /></label>{/if}
          {#if pflicht.has('ttr')}<label>{T.tspieler.ttr}<input bind:value={p.ttr} inputmode="numeric" maxlength="4" /></label>{/if}
          {#if pflicht.has('klasse')}<label>{T.meldung.klasse}<input bind:value={p.klasse} maxlength="40" /></label>{/if}
          {#if pflicht.has('geschlecht')}
            <label>{T.meldung.geschlecht}
              <select bind:value={p.geschlecht}>
                <option value=""></option><option value="w">{T.tspieler.geschlechter.w}</option><option value="m">{T.tspieler.geschlechter.m}</option><option value="d">{T.tspieler.geschlechter.d}</option>
              </select>
            </label>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  {#if personen.length < GRUPPE_MAX_PERSONEN}
    <button type="button" class="zweit" onclick={() => (personen = [...personen, neuePerson(naechster++)])} data-testid="g-person-neu">{T.meldung.gruppe.personNeu}</button>
  {/if}

  <h2>{T.meldung.gruppe.meldungen}</h2>
  {#each info.einstellungen.konkurrenzen as k (k.id)}
    <fieldset class="konkurrenz">
      <legend>{k.name} <span class="leise">{k.startgeld ? `· ${T.meldung.startgeld(euro(k.startgeld))}` : ''}{k.art === 'mannschaft' && gruppeErlaubt(k) ? ` · ${T.meldung.gruppe.staerke(k.min ?? 1, k.maxSpieler ?? 20)}` : ''}</span></legend>
      {#if einzelnErlaubt(k)}
        <p class="leise unter">{k.art === 'einzel' ? T.meldung.gruppe.einzelIn(k.name) : T.meldung.gruppe.einzelnFuer(k.name)}</p>
        <div class="haken-liste">
          {#each personen as p (p.key)}
            <label class="haken"><input type="checkbox" value={p.key} bind:group={einzeln[k.id]} /> {name(p.key)}</label>
          {/each}
        </div>
      {/if}
      {#if gruppeErlaubt(k) && (k.art === 'doppel' || k.art === 'mixed')}
        {#each paare[k.id] ?? [] as paar, i (i)}
          <div class="reihe paar">
            <span class="leise">{T.meldung.gruppe.paar(i + 1)}</span>
            {#each [0, 1] as j (j)}
              <select bind:value={paar[j]} aria-label="{T.meldung.gruppe.paar(i + 1)}, {j + 1}">
                <option value="">{T.meldung.gruppe.waehlen}</option>
                {#each personen as p (p.key)}<option value={p.key}>{name(p.key)}</option>{/each}
              </select>
            {/each}
            <button type="button" class="zweit klein" aria-label={T.meldung.gruppe.entfernen} onclick={() => (paare[k.id] = paare[k.id]!.filter((_, x) => x !== i))}>✕</button>
          </div>
        {/each}
        <button type="button" class="zweit klein" onclick={() => (paare[k.id] = [...(paare[k.id] ?? []), ['', '']])}>{T.meldung.gruppe.paarNeu}</button>
      {/if}
      {#if gruppeErlaubt(k) && k.art === 'mannschaft'}
        {#each teams[k.id] ?? [] as t, i (t.key)}
          {@const ok = !!t.name.trim() && t.spieler.length >= (k.min ?? 1) && t.spieler.length <= (k.maxSpieler ?? 20)}
          <div class="team" class:unvollstaendig={!ok} data-testid="g-team">
            <div class="reihe"><input class="wachsen" bind:value={t.name} maxlength="60" placeholder={`${leitung.verein.trim() || T.meldung.gruppe.verein} ${'I'.repeat(i + 1)}`} aria-label={T.meldung.gruppe.mannschaftName} data-testid="g-team-name" />
              <button type="button" class="zweit klein" aria-label={T.meldung.gruppe.entfernen} onclick={() => (teams[k.id] = teams[k.id]!.filter((x) => x.key !== t.key))}>✕</button>
            </div>
            <p class="leise unter">{T.meldung.gruppe.mannschaftSpieler} ({t.spieler.length} · {T.meldung.gruppe.staerke(k.min ?? 1, k.maxSpieler ?? 20)})</p>
            <div class="haken-liste">
              {#each personen as p (p.key)}<label class="haken"><input type="checkbox" value={p.key} bind:group={t.spieler} /> {name(p.key)}</label>{/each}
            </div>
            <label>{T.meldung.gruppe.fuehrer}
              <select bind:value={t.fuehrer}>
                <option value={-1}>{T.meldung.gruppe.fuehrerIch}</option>
                {#each t.spieler as key (key)}<option value={key}>{name(key)}</option>{/each}
              </select>
            </label>
            {#if t.spieler.length > (k.min ?? 1)}
              <div class="label-zeile"><span class="fett">{T.meldung.gruppe.wechsler}</span><Hilfe text={T.mannschaft.wechslerHilfe} /></div>
              <div class="haken-liste">
                {#each t.spieler as key (key)}<label class="haken"><input type="checkbox" value={key} bind:group={t.wechsler} /> {name(key)}</label>{/each}
              </div>
            {/if}
          </div>
        {/each}
        <button type="button" class="zweit klein" onclick={() => (teams[k.id] = [...(teams[k.id] ?? []), { key: naechster++, name: '', spieler: [], fuehrer: -1, wechsler: [] }])} data-testid="g-team-neu">{T.meldung.gruppe.mannschaftNeu}</button>
      {/if}
    </fieldset>
  {/each}

  <p class="leise" data-testid="g-zusammenfassung">{T.meldung.gruppe.zusammenfassung(personen.length, meldungen.length)}</p>
  <label class="haken"><input type="checkbox" bind:checked={volljaehrig} data-testid="g-volljaehrig" /> {T.meldung.gruppe.volljaehrig}</label>
  <label class="haken"><input type="checkbox" bind:checked={eltern} data-testid="g-eltern" /> {T.meldung.gruppe.eltern}</label>
  <p class="leise textbaustein">{T.textbaustein.text(info.turnier.veranstalter)}</p>
  <label class="haken"><input type="checkbox" bind:checked={datenschutz} data-testid="g-datenschutz" /> <span>{T.meldung.datenschutz} <a href={linkZu('datenschutz')} target="_blank" rel="noopener">{T.meldung.datenschutzLink}</a></span></label>
  <label class="haken"><input type="checkbox" bind:checked={verteiler} /> {T.verteiler.ausAnmeldung}</label>
  <div class="fang" aria-hidden="true"><label for="gw">Website</label><input id="gw" bind:value={website} tabindex="-1" autocomplete="off" /></div>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" class="breit" disabled={sendet} data-testid="g-senden">{T.meldung.gruppe.senden}</button>
</form>

<style>
  h2 { margin-top: 16px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .raster { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0 12px; }
  .personen { padding-left: 0; list-style: none; margin: 0 0 8px; }
  .personen li { border: 1px solid var(--linie); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
  .personen .kopf { margin-bottom: 4px; }
  .unvollstaendig { border-color: var(--orange) !important; }
  .konkurrenz { border: 1px solid var(--linie); border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; }
  .konkurrenz legend { padding: 0 4px; font-weight: 700; }
  .unter { margin: 4px 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; margin: 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken-liste { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0 12px; }
  .paar { margin: 6px 0; }
  .paar select { flex: 1 1 9rem; }
  .team { border: 1px dashed var(--linie); border-radius: 10px; padding: 8px 10px; margin: 8px 0; }
  .fett { font-weight: 600; }
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
</style>
