<script lang="ts">
  import Textbaustein from './Textbaustein.svelte';
  import { onMount, untrack } from 'svelte';
  import { alleGesehen, appHinweisAn, neueAnmeldungen, setzeAppHinweis } from '../../anmeldeHinweis';
  import type { AnmeldeForm, AnmeldeStatus, AnmeldungEinstellungen, AnmeldungEintrag, AnmeldungKonkurrenz } from '@shared/protokoll';
  import { T } from '../../texte';
  import { api } from '../../dienste';
  import { fehlerText } from '../../app.svelte';
  import { appBasis } from '../../zentrale.svelte';
  import { alsEineAktion } from '../../aktion';
  import { anmeldeKonkurrenzen, standardForm, uebernahmePlanen } from '../../engine/anmeldung';
  import { euro } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import QrCode from './QrCode.svelte';

  /**
   * Online-Anmeldung (nur Leitung, nur online): Anmeldung öffnen, Liste mit Warteliste,
   * Anmeldungen ins Turnier übernehmen.
   */
  let {
    z,
    turnierId,
    token,
    eintragen,
    neuGesehen = () => undefined,
  }: {
    z: TurnierZustand;
    turnierId: string;
    token: string;
    eintragen: (art: string, d: Record<string, unknown>, opt?: { id?: string }) => Promise<unknown>;
    /** Die Leitung hat die neuen Anmeldungen gesehen (Hinweis im Reiter zurücksetzen) */
    neuGesehen?: () => void;
  } = $props();

  let laedt = $state(true);
  let fehler = $state('');
  let hinweis = $state('');
  let einst = $state<AnmeldungEinstellungen | null>(null);
  /** „Einrichten“: zu, sobald die Anmeldung offen ist – Wahl der Leitung bleibt beim Nachladen (alle 2 min) erhalten */
  let einrichtenAuf = $state<boolean | null>(null);
  let liste = $state<AnmeldungEintrag[]>([]);
  let qr = $state(false);
  let sendet = $state(false);
  /** Ab Server 0.12: Online-Anmeldung für das Konto freigegeben? (null = ältere Server: immer) */
  let freigabe = $state<{ erlaubt: boolean; ab: string | null } | null>(null);

  // Formular
  let offen = $state(false);
  let schluss = $state('');
  let auswahl = $state<string[]>([]);
  let angaben = $state<string[]>([]);
  let hinweisText = $state('');
  let mitBank = $state(true);
  let hinweisMail = $state(true);
  /** ab 0.18: Anmeldeform je Konkurrenz (Doppel/Mixed/Mannschaft) und Gruppenanmeldung */
  let formen = $state<Record<string, AnmeldeForm>>({});
  let gruppen = $state(true);
  // svelte-ignore state_referenced_locally
  let appHinweis = $state(appHinweisAn(turnierId));
  /** Aufgeklappt: bei neuen Anmeldungen gleich offen */
  let aufgeklappt = $state(false);
  let neuAnzahl = $state(0);
  function appHinweisSetzen(an: boolean) {
    appHinweis = an;
    setzeAppHinweis(turnierId, an);
  }
  // Wer den Abschnitt aufklappt, hat die neuen Anmeldungen gesehen
  $effect(() => {
    if (!aufgeklappt || laedt) return;
    const l = liste;
    untrack(() => {
      alleGesehen(turnierId, l);
      neuGesehen();
    });
  });

  const link = $derived(`${appBasis()}#/meldung/${turnierId}`);
  const ids = $derived(new Set(liste.map((a) => a.id)));
  const gruppenIds = $derived(new Set(liste.filter((a) => a.typ === 'gruppe').map((a) => a.id)));
  /** Spieler aus einer Gruppenanmeldung (Anmelde-ID + „p…“) */
  const istGruppenSpieler = (m: string) => /^[a-z0-9]{10}p\d+$/.test(m) && gruppenIds.has(m.slice(0, 10));
  /** Konkurrenzen mit Belegung durch von Hand eingetragene Meldungen („vorab“) */
  function konkurrenzenFuer(wahl: string[]): (AnmeldungKonkurrenz & { vorab: number })[] {
    return anmeldeKonkurrenzen(z, wahl, formen).map((k) => {
      const kz = z.konkurrenzen[k.id]!;
      const vorab = kz.einst.art === 'einzel' ? kz.meldungen.filter((m) => !ids.has(m) && !istGruppenSpieler(m)).length : kz.meldungen.filter((m) => !/^[mp]-[a-z0-9]{10}\d+$/.test(m)).length;
      return { ...k, vorab };
    });
  }
  const bank = $derived(z.kasse?.iban ? { empfaenger: z.kasse.empfaenger || z.kasse.aussteller, iban: z.kasse.iban, bic: z.kasse.bic } : null);
  const plan = $derived(uebernahmePlanen(z, liste));
  const belegung = $derived.by(() => {
    const b: Record<string, { plaetze: number; warteliste: number }> = {};
    for (const a of liste) {
      if (!a.bestaetigt) continue;
      for (const k of a.konkurrenzen) {
        b[k.id] ??= { plaetze: 0, warteliste: 0 };
        if (k.status === 'platz') b[k.id]!.plaetze++;
        else if (k.status === 'warteliste') b[k.id]!.warteliste++;
      }
    }
    return b;
  });
  const sortiert = $derived(
    [...liste].sort((a, b) => Number(!a.bestaetigt) - Number(!b.bestaetigt) || `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, 'de')),
  );

  function formularAus(e: AnmeldungEinstellungen) {
    offen = e.offen;
    schluss = e.schluss ? lokaleZeit(e.schluss) : '';
    auswahl = e.konkurrenzen.length ? e.konkurrenzen.map((k) => k.id) : [...z.konkurrenzReihe];
    formen = Object.fromEntries(e.konkurrenzen.filter((k) => k.form).map((k) => [k.id, k.form!]));
    gruppen = e.gruppen !== false;
    angaben = [...e.angaben];
    hinweisText = e.hinweis;
    mitBank = e.bank !== null || !e.konkurrenzen.length;
    hinweisMail = e.hinweisMail !== false;
  }
  function lokaleZeit(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function einstellungenNeu(o = offen): AnmeldungEinstellungen {
    return {
      offen: o,
      schluss: schluss ? new Date(schluss).toISOString() : null,
      konkurrenzen: konkurrenzenFuer(auswahl),
      hinweis: hinweisText.trim(),
      angaben: angaben.filter((a) => z.angaben.includes(a as never)) as AnmeldungEinstellungen['angaben'],
      bank: mitBank ? bank : null,
      ort: z.ort,
      hinweisMail,
      gruppen,
    };
  }

  async function laden() {
    try {
      const a = await api.anmeldungen(token, turnierId);
      einst = a.einstellungen;
      liste = a.anmeldungen;
      freigabe = a.freigabe ?? null;
      formularAus(a.einstellungen);
      const frisch = neueAnmeldungen(turnierId, a.anmeldungen, (x) => !!z.spieler[x]);
      neuAnzahl = frisch.length;
      // Aufklappen, wenn es etwas zu tun gibt (neue Anmeldungen oder Übernahme ins Turnier)
      if (frisch.length || uebernahmePlanen(z, a.anmeldungen).schritte.length) aufgeklappt = true;
      fehler = '';
      // Konkurrenzen (Namen, Höchstzahl, Startgeld, von Hand Gemeldete) still nachziehen
      const neu = konkurrenzenFuer(a.einstellungen.konkurrenzen.map((k) => k.id));
      // Bei leerem oder noch unvollständigem Gerätespeicher darf die Serverbelegung nicht überschrieben werden.
      if (neu.length > 0 && neu.length === a.einstellungen.konkurrenzen.length && JSON.stringify(neu) !== JSON.stringify(a.einstellungen.konkurrenzen) && (z.datum || !a.einstellungen.offen)) {
        void api
          .anmeldungEinstellungen(token, turnierId, { ...a.einstellungen, konkurrenzen: neu })
          .then((r) => ((einst = r.einstellungen), (liste = r.anmeldungen)))
          .catch(() => undefined);
      }
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
  }
  onMount(() => void laden());

  async function speichern(o = offen, still = false) {
    if (!auswahl.length) {
      fehler = T.anm.auswahlFehlt;
      return;
    }
    sendet = true;
    try {
      const a = await api.anmeldungEinstellungen(token, turnierId, einstellungenNeu(o));
      einst = a.einstellungen;
      liste = a.anmeldungen;
      offen = a.einstellungen.offen;
      fehler = '';
      if (!still) hinweis = T.anm.gespeichert;
    } catch (x) {
      if (!still) fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }

  async function status(a: AnmeldungEintrag, konkurrenz: string, s: AnmeldeStatus, eintrag?: number) {
    if (s === 'abgemeldet' && !confirm(T.anm.streichenFrage)) return;
    try {
      const r = await api.anmeldungAendern(token, turnierId, a.id, konkurrenz, s, a.typ === 'gruppe' ? eintrag : undefined);
      liste = r.anmeldungen;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }
  async function loeschen(a: AnmeldungEintrag) {
    if (!confirm(T.anm.loeschenFrage)) return;
    try {
      liste = (await api.anmeldungLoeschen(token, turnierId, a.id)).anmeldungen;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }
  async function uebernehmen() {
    const p = plan;
    sendet = true;
    try {
      await alsEineAktion(async () => {
        for (const s of p.schritte) await eintragen(s.art, s.daten, s.id ? { id: s.id } : {});
      });
      if (p.uebernommen.length) await api.anmeldungUebernommen(token, turnierId, p.uebernommen);
      hinweis = T.anm.uebernommen(p.schritte.length);
      await laden();
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      prompt(T.anm.link, link);
    }
  }
  const angabenNamen: Record<string, string> = { ttr: T.meldung.ttr, klasse: T.meldung.klasse, geschlecht: T.meldung.geschlecht, jahrgang: T.meldung.jahrgang };
</script>

<details class="karte abschnitt" bind:open={aufgeklappt} data-testid="abschnitt-anmeldungen">
  <summary>
    <h2 class="titel">{T.anm.abschnitt} <span class="leise">({liste.length})</span></h2>
    {#if neuAnzahl}<span class="marke neu" data-testid="anmeldung-neu">{T.anm.neu(neuAnzahl)}</span>{/if}
  </summary>
  {#if laedt}
    <p class="leise">{T.app.laden}</p>
  {:else}
    {#if !z.datum}<div class="meldung info">{T.anm.keinDatum}</div>{/if}
    <p class="reihe">
      <span class="marke" class:online={einst?.offen} data-testid="anmeldung-status">{einst?.offen ? T.anm.offen : T.anm.geschlossen}</span>
      <Hilfe text={T.anm.hilfe} />
    </p>
    {#if einst?.offen}
      <div class="reihe">
        <input class="wachsen" readonly value={link} aria-label={T.anm.link} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} data-testid="anmeldung-link" />
        <button class="zweit" onclick={kopieren}>{T.turnier.linkKopieren}</button>
        <button class="zweit" aria-expanded={qr} onclick={() => (qr = !qr)}>{T.turnier.qr}</button>
      </div>
      {#if qr}<div class="qr"><QrCode text={link} groesse={220} label={T.anm.link} /></div>{/if}
    {/if}
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    {#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}
    <h3>{T.anm.liste} <span class="leise">({liste.length})</span></h3>
    {#if plan.schritte.length}
      <div class="meldung info uebernahme">
        <button disabled={sendet} onclick={uebernehmen} data-testid="anmeldung-uebernehmen">{T.anm.uebernehmen(plan.schritte.length)}</button>
        <Hilfe text={T.anm.uebernehmenHilfe} />
      </div>
    {:else if liste.some((a) => a.bestaetigt)}
      <p class="leise">{T.anm.nichtsZuUebernehmen}</p>
    {/if}
    {#if plan.hinweise.length}
      <details class="hinweise">
        <summary>{T.anm.hinweise} ({plan.hinweise.length})</summary>
        <ul>{#each plan.hinweise as h (h)}<li>{h}</li>{/each}</ul>
      </details>
    {/if}
    {#if !liste.length}
      <p class="leise">{T.anm.leer}</p>
    {:else}
      <ul class="liste" data-testid="anmeldung-liste">
        {#each sortiert as a (a.id)}
          <li class:unbestaetigt={!a.bestaetigt}>
            <div class="kopfzeile">
              <strong class="wachsen">{a.vorname} {a.nachname}</strong>
              {#if a.typ === 'gruppe'}<span class="marke" data-testid="gruppe-marke">{T.anm.gruppeMarke(a.personen?.length ?? 0)}</span>{/if}
              {#if !a.bestaetigt}<span class="marke">{T.anm.unbestaetigt}</span>{/if}
              {#if z.spieler[a.id] || (a.typ === 'gruppe' && a.spieler)}<span class="marke online">{T.anm.imTurnier}</span>{/if}
            </div>
            <div class="leise">
              {[a.verein, a.ttr !== null ? `TTR ${a.ttr}` : '', a.klasse ?? '', a.jahrgang ? String(a.jahrgang) : ''].filter(Boolean).join(' · ')}
              {#if a.verein || a.ttr !== null} · {/if}<a href="mailto:{a.email}">{a.email}</a>
            </div>
            {#if a.typ === 'gruppe' && a.personen}
              <p class="leise personen">{a.personen.map((p) => [`${p.vorname} ${p.nachname}`, p.ttr !== null ? `TTR ${p.ttr}` : '', p.klasse ?? '', p.jahrgang ? String(p.jahrgang) : ''].filter(Boolean).join(' · ')).join('; ')}</p>
            {/if}
            {#if a.bestaetigt}
              <ul class="meldungen">
                {#each a.konkurrenzen as k, i (k.eintrag ?? `${k.id}-${i}`)}
                  {@const pers = new Map((a.personen ?? []).map((p) => [p.pid, `${p.vorname} ${p.nachname}`]))}
                  <li>
                    <span class="wachsen">
                      {z.konkurrenzen[k.id]?.einst.name ?? k.id}{#if k.mannschaft} – {k.mannschaft.name}{/if}{#if k.wer}<span class="leise"> ({k.wer.map((x) => (k.mannschaft?.wechsler.includes(x) ? `${pers.get(x)} (${T.mannschaft.wechslerKurz})` : pers.get(x))).join(', ')}{#if k.mannschaft} · MF: {k.mannschaft.fuehrer === 'leitung' ? `${a.vorname} ${a.nachname} (${T.mannschaft.begleitung})` : pers.get(k.mannschaft.fuehrer)}{/if})</span>{/if}:
                      <strong class="st-{k.status}">{k.status === 'warteliste' ? T.anm.position(k.position) : T.anm.status[k.status]}</strong>
                      {#if k.partner}<span class="leise"> · {T.anm.partner(k.partner)}</span>{/if}
                      {#if k.partnerStatus}<span class="marke" class:offen={k.partnerStatus !== 'bestaetigt'} data-testid="partner-status">{T.meldung.partnerStatus[k.partnerStatus]}</span>{/if}
                    </span>
                    {#if k.status !== 'platz'}<button class="zweit klein" onclick={() => status(a, k.id, 'platz', k.eintrag)}>{T.anm.platzGeben}</button>{/if}
                    {#if k.status === 'platz'}<button class="zweit klein" onclick={() => status(a, k.id, 'warteliste', k.eintrag)}>{T.anm.aufWarteliste}</button>{/if}
                    {#if k.status !== 'abgemeldet'}<button class="gefahr klein" onclick={() => status(a, k.id, 'abgemeldet', k.eintrag)}>{T.anm.streichen}</button>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            <button class="zweit klein" onclick={() => loeschen(a)}>{T.anm.loeschen}</button>
          </li>
        {/each}
      </ul>
    {/if}

    <Textbaustein />
    <details class="einrichten" open={einrichtenAuf ?? !einst?.offen} ontoggle={(e) => (einrichtenAuf = e.currentTarget.open === !einst?.offen ? null : e.currentTarget.open)}>
      <summary>{T.anm.einrichten}</summary>
    <fieldset>
      <legend>{T.anm.konkurrenzen}<Hilfe text={T.anm.konkurrenzenHilfe} /></legend>
      {#if !z.konkurrenzReihe.length}<p class="leise">{T.anm.keineKonkurrenzen}</p>{/if}
      {#each z.konkurrenzReihe as kid (kid)}
        {@const k = z.konkurrenzen[kid]!}
        <label class="haken">
          <input type="checkbox" value={kid} bind:group={auswahl} />
          <span>
            {k.einst.name}
            <span class="leise">
              {[
                T.anm.platz((belegung[kid]?.plaetze ?? 0) + (konkurrenzenFuer([kid])[0]?.vorab ?? 0), k.einst.maxTeilnehmer),
                belegung[kid]?.warteliste ? T.anm.warteliste(belegung[kid]!.warteliste) : '',
                k.einst.startgeld ? euro(k.einst.startgeld) : '',
              ]
                .filter(Boolean)
                .map((x) => ` · ${x}`)
                .join('')}
            </span>
          </span>
        </label>
        {#if k.einst.art !== 'einzel' && auswahl.includes(kid)}
          <div class="form-wahl">
            <select bind:value={() => formen[kid] ?? standardForm(k.einst.art), (v) => (formen = { ...formen, [kid]: v })} aria-label="{T.anm.form}: {k.einst.name}" data-testid="anmeldeform">
              {#each ['gruppe', 'einzel', 'beides'] as f (f)}<option value={f}>{T.anm.formen(k.einst.art === 'mannschaft')[f]}</option>{/each}
            </select>
            <Hilfe text={T.anm.formHilfe} />
          </div>
        {/if}
      {/each}
    </fieldset>
    <div class="label-zeile"><label class="haken"><input type="checkbox" bind:checked={gruppen} data-testid="gruppen-an" /> {T.anm.gruppen}</label><Hilfe text={T.anm.gruppenHilfe} /></div>
    {#if z.angaben.length}
      <fieldset>
        <legend>{T.anm.angaben}</legend>
        {#each z.angaben as a (a)}<label class="haken"><input type="checkbox" value={a} bind:group={angaben} /> {angabenNamen[a]}</label>{/each}
      </fieldset>
    {/if}
    <div class="label-zeile"><label for="an-schluss">{T.anm.schluss}</label><Hilfe text={T.anm.schlussHilfe} /></div>
    <input id="an-schluss" type="datetime-local" bind:value={schluss} />
    <label>{T.anm.hinweis}<textarea bind:value={hinweisText} maxlength="1000" rows="3"></textarea></label>
    {#if bank}
      <div class="haken"><input id="an-bank" type="checkbox" bind:checked={mitBank} /><label for="an-bank">{T.anm.bank}</label><Hilfe text={T.anm.bankHilfe} /></div>
    {:else}
      <p class="leise">{T.anm.ohneBank}</p>
    {/if}
    <fieldset>
      <legend>{T.anm.hinweisTitel}<Hilfe text={T.anm.hinweisHilfe} /></legend>
      <label class="haken"><input type="checkbox" bind:checked={hinweisMail} data-testid="hinweis-mail" /> {T.anm.hinweisMail}</label>
      <label class="haken"><input type="checkbox" checked={appHinweis} onchange={(ev) => appHinweisSetzen((ev.currentTarget as HTMLInputElement).checked)} data-testid="hinweis-app" /> {T.anm.hinweisApp}</label>
    </fieldset>
    {#if freigabe && !freigabe.erlaubt}
      <div class="meldung info" role="status" data-testid="anmeldung-freigabe">{T.anm.nochNichtFrei(freigabe.ab)}</div>
    {/if}
    <div class="reihe">
      {#if einst?.offen}
        <button disabled={sendet} onclick={() => speichern(true)}>{T.anm.speichern}</button>
        <button class="zweit" disabled={sendet} onclick={() => speichern(false)} data-testid="anmeldung-schliessen">{T.anm.schliessen}</button>
      {:else}
        <button disabled={sendet || !z.datum || !z.konkurrenzReihe.length || (freigabe !== null && !freigabe.erlaubt)} onclick={() => speichern(true)} data-testid="anmeldung-oeffnen">{T.anm.oeffnen}</button>
      {/if}
    </div>
    </details>
  {/if}
</details>

<style>
  .form-wahl { display: flex; align-items: center; gap: 6px; margin: 0 0 8px 32px; }
  .form-wahl select { flex: 1; }
  .personen { margin: 4px 0; }
  h3 { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 16px; }
  .abschnitt > summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 44px; cursor: pointer; }
  .abschnitt > summary .titel { font-size: 1.2rem; margin: 0; }
  .marke.offen { color: var(--orange-text); }
  .einrichten { margin-top: 16px; border-top: 1px solid var(--linie); padding-top: 8px; }
  .einrichten > summary { min-height: 44px; display: flex; align-items: center; font-weight: 700; cursor: pointer; }
  .marke.neu { background: var(--orange); color: #fff; }
  fieldset { border: 0; padding: 0; margin: 12px 0; }
  legend { font-weight: 700; display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  textarea { width: 100%; }
  .qr { margin: 8px 0; }
  .uebernahme { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .kopfzeile { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .meldungen { list-style: none; padding: 0; margin: 6px 0; display: flex; flex-direction: column; gap: 6px; }
  .meldungen li { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .unbestaetigt { opacity: 0.75; }
  .st-platz { color: var(--gruen); }
  .st-warteliste { color: var(--orange-text); }
  .st-abgemeldet { color: var(--leise); text-decoration: line-through; }
  .hinweise { margin: 8px 0; }
  a { overflow-wrap: anywhere; }
</style>
