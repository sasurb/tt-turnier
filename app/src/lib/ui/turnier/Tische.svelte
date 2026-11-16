<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { anstehendeSpiele, automatischeAufrufe, beschaeftigt, freierTisch, name, rundeVon, tische, verliererAmTisch } from '../../engine/abfragen';
  import { spielerName, uhrzeitText, type Spiel } from '../../engine/modell';
  import { gelernteSatzMinuten, zeitplanGedrosselt, zeitplanSofort } from '../../engine/zeitplan';
  import { spielerVon, type TurnierZustand } from '../../engine/zustand';
  import { Ansager, ansageText, aufrufeVon, aufrufGeraet, neueAufrufe, setzeAufrufGeraet, type AufrufGeraet } from '../../ansage';
  import Hilfe from '../Hilfe.svelte';

  /**
   * Tische und Spielaufruf. Leitung und Helfer rufen Spiele an freie Tische, wählen einen
   * Schiedsrichter und sperren Tische; alle anderen sehen nur, was gerade läuft und was als Nächstes kommt.
   * Auf Wunsch belegt das Gerät freie Tische selbst und sagt Aufrufe an.
   */
  let {
    z,
    turnierId,
    leitung = false,
    ich = null,
    darfAufrufen,
    mitSchiri,
    eintragen,
    oeffnen,
  }: {
    z: TurnierZustand;
    turnierId: string;
    leitung?: boolean;
    /** Spieler mit Helfer-Recht: eigene Spiele werden nicht automatisch aufgerufen */
    ich?: string | null;
    darfAufrufen: boolean;
    /** Schiedsrichter-Namen nur für Angemeldete, nicht für Zuschauer (Datenminimierung) */
    mitSchiri: boolean;
    eintragen: (art: string, d: Record<string, unknown>, opt?: { still?: boolean }) => Promise<unknown>;
    oeffnen: (s: Spiel) => void;
  } = $props();

  let jetzt = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (jetzt = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  const liste = $derived(tische(z));
  const naechste = $derived(anstehendeSpiele(z, jetzt));
  const frei = $derived(freierTisch(z));
  const belegt = $derived(beschaeftigt(z));

  let aufruf = $state<{ spiel: Spiel; tisch: number; schiri: string; schiriName: string } | null>(null);
  let fehler = $state('');

  function ort(s: Spiel) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    return `${k.einst.name} · ${rundeVon(k, s)}`;
  }
  function minuten(t: string | null) {
    return t ? Math.max(0, Math.floor((jetzt - Date.parse(t)) / 60000)) : 0;
  }
  function beteiligte(s: Spiel) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    return [...spielerVon(k, s.a), ...spielerVon(k, s.b)];
  }
  /** Schiedsrichter-Vorschläge: Spieler, die gerade weder spielen noch pfeifen (und nicht im Spiel) */
  function schiriVorschlaege(s: Spiel) {
    const b = beteiligte(s);
    return z.spielerReihe.filter((id) => !belegt.has(id) && !b.includes(id));
  }
  function vorbereiten(s: Spiel, tisch?: number) {
    fehler = '';
    const t = tisch ?? frei ?? 0;
    const v = t ? verliererAmTisch(z, t, beteiligte(s)) : null;
    aufruf = { spiel: s, tisch: t, schiri: v ?? '', schiriName: '' };
  }
  const verlierer = $derived(aufruf && aufruf.tisch ? verliererAmTisch(z, aufruf.tisch, beteiligte(aufruf.spiel)) : null);
  async function aufrufen(e: SubmitEvent) {
    e.preventDefault();
    if (!aufruf || !aufruf.tisch) return;
    const schiri = aufruf.schiri === '_name' ? (aufruf.schiriName.trim() ? { name: aufruf.schiriName.trim() } : null) : aufruf.schiri ? { spieler: aufruf.schiri } : null;
    try {
      await eintragen(ART.spielAufgerufen, { konkurrenz: aufruf.spiel.konkurrenz, spiel: aufruf.spiel.id, tisch: aufruf.tisch, ...(schiri ? { schiri } : {}) });
      aufruf = null;
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function zurueck(s: Spiel) {
    await eintragen(ART.spielAufrufZurueck, { konkurrenz: s.konkurrenz, spiel: s.id });
  }
  async function sperren(nr: number, gesperrt: boolean) {
    await eintragen(ART.tischGesperrt, { nr, gesperrt });
  }
  async function pauseSetzen(min: number) {
    await eintragen(ART.turnierDaten, { pause: min });
  }

  /* ---------- Einstellungen am Gerät: Ansage und automatisch belegen ---------- */
  // svelte-ignore state_referenced_locally
  let geraet = $state<AufrufGeraet>(aufrufGeraet(turnierId));
  function geraetSetzen(neu: Partial<AufrufGeraet>) {
    geraet = { ...geraet, ...neu };
    setzeAufrufGeraet(turnierId, geraet);
  }

  const ansager = new Ansager();
  let tonBereit = $state(false);
  let keineStimme = $state(false);
  const bekannt = new Set<string>();
  async function ansageEin(an: boolean) {
    geraetSetzen({ ansage: an });
    if (!an) {
      ansager.stoppen();
      return;
    }
    keineStimme = false;
    tonBereit = await ansager.freischalten();
    keineStimme = !tonBereit;
    for (const a of aufrufeVon(z)) bekannt.add(a.schluessel); // nur künftige Aufrufe ansagen
  }
  $effect(() => {
    const neu = neueAufrufe(bekannt, aufrufeVon(z));
    if (!tonBereit || !geraet.ansage) return;
    for (const a of neu) untrack(() => ansager.sagen(ansageText(z, a)));
  });
  function wiederholen(s: Spiel) {
    const a = aufrufeVon(z).find((x) => x.spiel.id === s.id && x.spiel.konkurrenz === s.konkurrenz);
    if (a) ansager.sagen(ansageText(z, a));
  }

  /**
   * Gerade gesendete automatische Aufrufe (Spiel → Tisch, Zeit), damit nichts doppelt rausgeht. Zeigt der
   * Stand einen Aufruf nach 10 s nicht (abgelehnt, z. B. weil ein anderes Gerät schneller war), wird das
   * Spiel 5 Minuten zurückgestellt – so entsteht keine Schleife aus abgelehnten Einträgen.
   */
  const unterwegs = new Map<string, { tisch: number; seit: number }>();
  const zurueckgestellt = new Map<string, number>();
  $effect(() => {
    if (!darfAufrufen || !geraet.automatisch) return;
    const zStand = z;
    void jetzt;
    untrack(() => {
      const t = Date.now();
      for (const [k, u] of unterwegs) {
        const [kid, sid] = k.split('/');
        const s = zStand.konkurrenzen[kid!]?.spiele[sid!];
        if (s && s.tisch === u.tisch && s.aufgerufen) unterwegs.delete(k);
        else if (t - u.seit > 10_000) {
          unterwegs.delete(k);
          zurueckgestellt.set(k, t + 5 * 60_000);
        }
      }
      for (const [k, bis] of zurueckgestellt) if (bis < t) zurueckgestellt.delete(k);
      const sperre = new Set([...zurueckgestellt.keys(), ...unterwegs.keys()]);
      const tischeUnterwegs = new Set([...unterwegs.values()].map((u) => u.tisch));
      for (const p of automatischeAufrufe(zStand, t, geraet.schiriVerlierer, ich, sperre)) {
        if (tischeUnterwegs.has(p.tisch)) continue;
        unterwegs.set(`${p.spiel.konkurrenz}/${p.spiel.id}`, { tisch: p.tisch, seit: t });
        tischeUnterwegs.add(p.tisch);
        void eintragen(ART.spielAufgerufen, { konkurrenz: p.spiel.konkurrenz, spiel: p.spiel.id, tisch: p.tisch, ...(p.schiri ? { schiri: { spieler: p.schiri } } : {}) }, { still: true }).catch(() => undefined);
      }
    });
  });
  onDestroy(() => ansager.stoppen());

  /* ---------- Zeitplan ---------- */
  // Gedrosselt: bei großen Turnieren nicht bei jedem Eintrag neu rechnen (siehe zeitplanGedrosselt)
  // svelte-ignore state_referenced_locally
  let plan = $state.raw(zeitplanSofort(z, jetzt));
  $effect(() => {
    const zz = z;
    const jj = jetzt;
    zeitplanGedrosselt(zz, jj, (p) => (plan = p));
  });
  const gelernt = $derived(gelernteSatzMinuten(z));
  const offeneKonkurrenzen = $derived(z.konkurrenzReihe.filter((id) => plan.konkurrenzEnde.get(id) !== null));
  function planName(e: { spiel: string | null; konkurrenz: string; titel: string }): string {
    const k = z.konkurrenzen[e.konkurrenz]!;
    const s = e.spiel ? k.spiele[e.spiel] : undefined;
    if (!s) return `${k.einst.name} · ${e.titel} (${T.tische.spaeter})`;
    return `${s.a ? name(z, s.a) : '?'} – ${s.b ? name(z, s.b) : '?'}`;
  }
  async function zeitplanSetzen(d: Record<string, unknown>) {
    await eintragen(ART.turnierDaten, d);
  }
  /** Vorgeplantes Spiel für einen Tisch (noch nicht aufgerufen) */
  function geplantFuer(nr: number): Spiel | null {
    return naechste.find((a) => a.spiel.plan?.tisch === nr)?.spiel ?? null;
  }

  /* ---------- Vorplanen (Dialog) ---------- */
  let planen = $state<{ spiel: Spiel; tisch: string; zeit: string } | null>(null);
  function planenOeffnen(s: Spiel) {
    planen = { spiel: s, tisch: s.plan?.tisch ? String(s.plan.tisch) : '', zeit: s.plan?.zeit ?? '' };
  }
  async function planSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (!planen) return;
    const tisch = planen.tisch ? Number(planen.tisch) : null;
    const zeit = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(planen.zeit) ? planen.zeit : null;
    await eintragen(ART.spielGeplant, { konkurrenz: planen.spiel.konkurrenz, spiel: planen.spiel.id, tisch, zeit });
    planen = null;
  }
  async function planAufheben() {
    if (!planen) return;
    await eintragen(ART.spielGeplant, { konkurrenz: planen.spiel.konkurrenz, spiel: planen.spiel.id, tisch: null, zeit: null });
    planen = null;
  }

  /* ---------- Ziehen auf einen Tisch (Finger, Maus, Stift) ---------- */
  let ziehen = $state<{ spiel: Spiel; x: number; y: number; ziel: number | null } | null>(null);
  let ablageHinweis = $state('');
  function zielUnter(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest('[data-tisch]') as HTMLElement | null;
    return el ? Number(el.dataset.tisch) : null;
  }
  function griffRunter(e: PointerEvent, s: Spiel) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* ohne Capture geht es auch: Bewegungen kommen weiter am Griff an */
    }
    ziehen = { spiel: s, x: e.clientX, y: e.clientY, ziel: null };
  }
  function griffBewegen(e: PointerEvent) {
    if (!ziehen) return;
    ziehen.x = e.clientX;
    ziehen.y = e.clientY;
    ziehen.ziel = zielUnter(e.clientX, e.clientY);
    // am Rand mitscrollen, damit Tische außerhalb des Bildschirms erreichbar sind
    if (e.clientY < 90) scrollBy(0, -14);
    else if (e.clientY > innerHeight - 70) scrollBy(0, 14);
  }
  async function griffHoch(e: PointerEvent) {
    if (!ziehen) return;
    const z0 = ziehen;
    ziehen = null;
    const nr = zielUnter(e.clientX, e.clientY) ?? z0.ziel;
    if (nr !== null) await ablegen(z0.spiel, nr);
  }
  async function ablegen(s: Spiel, nr: number) {
    fehler = '';
    ablageHinweis = '';
    const t = liste.find((x) => x.nr === nr);
    if (!t || t.gesperrt) return;
    if (!t.spiel) {
      // freier Tisch: sofort aufrufen (Schiedsrichter wie beim automatischen Belegen)
      const v = geraet.schiriVerlierer ? verliererAmTisch(z, nr, beteiligte(s)) : null;
      await eintragen(ART.spielAufgerufen, { konkurrenz: s.konkurrenz, spiel: s.id, tisch: nr, ...(v ? { schiri: { spieler: v } } : {}) });
      ablageHinweis = T.tische.abgelegt(nr);
    } else if (leitung) {
      await eintragen(ART.spielGeplant, { konkurrenz: s.konkurrenz, spiel: s.id, tisch: nr, zeit: s.plan?.zeit ?? null });
      ablageHinweis = T.tische.alsNaechstes(nr);
    }
  }

  const PAUSEN = [0, 2, 3, 5, 8, 10, 15];
  const SATZ_MINUTEN = [2, 3, 4, 5, 6, 7, 8, 10];
  function namen(ids: string[]) {
    return ids.map((id) => spielerName(z.spieler[id])).join(', ');
  }
</script>

{#if darfAufrufen}
  <details class="karte geraet" data-testid="aufruf-einstellungen">
    <summary>{T.tische.einstellungen}{#if geraet.automatisch}<span class="marke an">{T.tische.automatischAn}</span>{/if}{#if geraet.ansage && tonBereit}<span class="marke an">🔊</span>{/if}</summary>
    <label class="haken"><input type="checkbox" checked={geraet.automatisch} onchange={(e) => geraetSetzen({ automatisch: e.currentTarget.checked })} data-testid="automatisch" /> <span>{T.tische.automatisch}<Hilfe text={T.tische.automatischHilfe} /></span></label>
    {#if geraet.automatisch}
      <label class="haken eingerueckt"><input type="checkbox" checked={geraet.schiriVerlierer} onchange={(e) => geraetSetzen({ schiriVerlierer: e.currentTarget.checked })} /> {T.tische.schiriVerlierer}</label>
    {/if}
    <label class="haken"><input type="checkbox" checked={geraet.ansage} onchange={(e) => ansageEin(e.currentTarget.checked)} data-testid="ansage" /> <span>{T.tische.ansage}<Hilfe text={T.tische.ansageHilfe} /></span></label>
    {#if geraet.ansage && !tonBereit && !keineStimme}
      <button class="zweit klein eingerueckt" onclick={() => ansageEin(true)}>{T.tische.tonAn}</button>
    {/if}
    {#if keineStimme}<p class="meldung info">{T.tische.keineStimme}</p>{/if}
    {#if leitung}
      <div class="label-zeile"><label for="pause">{T.tische.pause}</label><Hilfe text={T.tische.pauseHilfe} /></div>
      <select id="pause" value={z.pause} onchange={(e) => pauseSetzen(Number(e.currentTarget.value))} data-testid="pause">
        {#each PAUSEN.includes(z.pause) ? PAUSEN : [...PAUSEN, z.pause].sort((a, b) => a - b) as p (p)}<option value={p}>{p === 0 ? T.tische.pauseAus : T.tische.pauseMin(p)}</option>{/each}
      </select>
    {/if}
  </details>
{/if}

<section class="karte">
  <h2>{T.tische.titel}<Hilfe text={T.tische.anzahlHilfe} /></h2>
  <p class="leise">{darfAufrufen ? T.tische.text : T.tische.zuschauerText}</p>
  <ul class="tische" data-testid="tische">
    {#each liste as t (t.nr)}
      <li class="tisch" class:frei={!t.spiel && !t.gesperrt} class:gesperrt={t.gesperrt} class:ziel={ziehen?.ziel === t.nr && !t.gesperrt} data-tisch={t.nr} data-testid="tisch-{t.nr}">
        <div class="kopf">
          <strong>{T.tische.tisch(t.nr)}</strong>
          {#if t.gesperrt}<span class="marke">{T.tische.gesperrt}</span>{:else if !t.spiel}<span class="marke frei">{T.tische.frei}</span>{:else}<span class="leise">{T.tische.seit(minuten(t.spiel.aufgerufen))}</span>{/if}
        </div>
        {#if t.spiel}
          {@const s = t.spiel}
          <div class="paarung">{name(z, s.a)} – {name(z, s.b)}</div>
          <div class="leise klein">{ort(s)}{mitSchiri && s.schiri ? ` · ${T.spiele.schiri(s.schiri.name)}` : ''}</div>
          {#if darfAufrufen}
            <div class="reihe knoepfe">
              <button class="klein" onclick={() => oeffnen(s)}>{T.tische.ergebnis}</button>
              <button class="zweit klein" onclick={() => zurueck(s)}>{T.tische.zurueck}</button>
              {#if tonBereit && geraet.ansage}<button class="zweit klein" onclick={() => wiederholen(s)} aria-label={T.tische.wiederholen}>🔊</button>{/if}
            </div>
          {/if}
          {@const g = geplantFuer(t.nr)}
          {#if g}<div class="leise klein geplant">{T.tische.alsNaechstes(t.nr)}: {name(z, g.a)} – {name(z, g.b)}</div>{/if}
        {:else if darfAufrufen}
          {#if ziehen && !t.gesperrt}<div class="ablage">{T.tische.hierAblegen}</div>{/if}
          <div class="reihe knoepfe">
            {#if !t.gesperrt && naechste.length}
              <button class="klein" onclick={() => vorbereiten(naechste[0]!.spiel, t.nr)} data-testid="tisch-belegen">{T.tische.aufrufen}</button>
            {/if}
            {#if leitung}
              <button class="zweit klein" onclick={() => sperren(t.nr, !t.gesperrt)} title={T.tische.sperrenHilfe}>{t.gesperrt ? T.tische.freigeben : T.tische.sperren}</button>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

{#if aufruf}
  <form class="karte aufruf" onsubmit={aufrufen} data-testid="aufruf">
    <h2>{T.tische.aufrufTitel}</h2>
    <p><strong>{name(z, aufruf.spiel.a)} – {name(z, aufruf.spiel.b)}</strong><br /><span class="leise">{ort(aufruf.spiel)}</span></p>
    <label for="at">{T.tische.tischWahl}</label>
    <select id="at" bind:value={aufruf.tisch}>
      {#each liste.filter((t) => !t.spiel && !t.gesperrt) as t (t.nr)}<option value={t.nr}>{T.tische.tisch(t.nr)}</option>{/each}
    </select>
    {#if !liste.some((t) => !t.spiel && !t.gesperrt)}<p class="meldung info">{T.tische.keinTisch}</p>{/if}
    <div class="label-zeile"><label for="as">{T.tische.schiri}</label><Hilfe text={T.tische.schiriHilfe} /></div>
    <select id="as" bind:value={aufruf.schiri}>
      <option value="">{T.tische.schiriKeiner}</option>
      {#if verlierer}<option value={verlierer}>{spielerName(z.spieler[verlierer])} ({T.tische.verliererVorher})</option>{/if}
      <optgroup label={T.tische.schiriFrei}>
        {#each schiriVorschlaege(aufruf.spiel).filter((id) => id !== verlierer) as id (id)}
          <option value={id}>{spielerName(z.spieler[id])}</option>
        {/each}
      </optgroup>
      <option value="_name">{T.tische.schiriName}</option>
    </select>
    {#if aufruf.schiri === '_name'}
      <input bind:value={aufruf.schiriName} maxlength="80" aria-label={T.tische.schiri} autocomplete="off" />
    {/if}
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe" style="margin-top:12px">
      <button type="submit" disabled={!aufruf.tisch} data-testid="aufrufen">{T.tische.aufrufen}</button>
      <button type="button" class="zweit" onclick={() => (aufruf = null)}>{T.app.abbrechen}</button>
    </div>
  </form>
{/if}

<section class="karte">
  <h2>{T.tische.naechste}<Hilfe text={T.tische.naechsteText} /></h2>
  {#if naechste.length === 0}
    <p class="leise">{T.tische.keineNaechsten}</p>
  {:else}
    <ul class="liste" data-testid="naechste">
      {#each naechste.slice(0, 20) as a (a.spiel.konkurrenz + a.spiel.id)}
        {@const geschaetzt = plan.spiele.get(`${a.spiel.konkurrenz}/${a.spiel.id}`)}
        <li class="naechstes" class:wartet={!a.bereit} class:gezogen={ziehen?.spiel === a.spiel}>
          {#if darfAufrufen}
            <button
              class="griff zweit"
              aria-label={T.tische.griff(`${name(z, a.spiel.a)} – ${name(z, a.spiel.b)}`)}
              title={T.tische.ziehenHilfe}
              onpointerdown={(e) => griffRunter(e, a.spiel)}
              onpointermove={griffBewegen}
              onpointerup={griffHoch}
              onpointercancel={() => (ziehen = null)}
              data-testid="griff">⠿</button
            >
          {/if}
          <div class="wachsen">
            <strong>{name(z, a.spiel.a)} – {name(z, a.spiel.b)}</strong>
            <div class="leise klein">
              {ort(a.spiel)}{a.wartetAuf.length ? ` · ${T.tische.wartetAuf(namen(a.wartetAuf))}` : ''}{a.inPause.length ? ` · ${T.tische.inPause(namen(a.inPause))}` : ''}{a.ab ? ` · ${T.tische.ab(a.ab)}` : ''}
              {#if a.spiel.plan?.tisch} · <span class="geplant">{T.spiele.tisch(a.spiel.plan.tisch)}</span>{/if}
              {#if geschaetzt && !geschaetzt.laeuft} · <span class="geplant">{T.spiele.ca(uhrzeitText(geschaetzt.start))}</span>{/if}
            </div>
          </div>
          {#if darfAufrufen}
            <div class="aktionen">
              {#if leitung}<button class="zweit klein" onclick={() => planenOeffnen(a.spiel)} data-testid="planen">{T.tische.planen}</button>{/if}
              <button class="klein" class:zweit={!a.bereit || !frei} onclick={() => vorbereiten(a.spiel)} disabled={!frei}>{frei ? T.tische.aufrufenAn(frei) : T.tische.aufrufen}</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if darfAufrufen}<p class="leise klein">{T.tische.ziehenHilfe}</p>{/if}
    {#if ablageHinweis}<p class="meldung ok" role="status">{ablageHinweis}</p>{/if}
  {/if}
</section>

{#if planen}
  <form class="karte aufruf" onsubmit={planSpeichern} data-testid="planen-form">
    <h2>{T.tische.planenTitel}</h2>
    <p><strong>{name(z, planen.spiel.a)} – {name(z, planen.spiel.b)}</strong><br /><span class="leise">{ort(planen.spiel)}</span></p>
    <p class="leise">{T.tische.planenText}</p>
    <div class="raster">
      <div>
        <label for="pt">{T.tische.planenTisch}</label>
        <select id="pt" bind:value={planen.tisch}>
          <option value="">{T.tische.planenTischEgal}</option>
          {#each liste.filter((t) => !t.gesperrt) as t (t.nr)}<option value={String(t.nr)}>{T.tische.tisch(t.nr)}</option>{/each}
        </select>
      </div>
      <div>
        <label for="pz">{T.tische.planenZeit}</label>
        <input id="pz" type="time" bind:value={planen.zeit} />
      </div>
    </div>
    <div class="reihe" style="margin-top:12px">
      <button type="submit" data-testid="planen-speichern">{T.tische.planenSpeichern}</button>
      {#if planen.spiel.plan}<button type="button" class="zweit" onclick={planAufheben}>{T.tische.planenAufheben}</button>{/if}
      <button type="button" class="zweit" onclick={() => (planen = null)}>{T.app.abbrechen}</button>
    </div>
  </form>
{/if}

<details class="karte zeitplan" data-testid="zeitplan" open>
  <summary>{T.tische.zeitplan}<Hilfe text={T.tische.zeitplanHilfe} /></summary>
  {#if plan.ende === null}
    <p class="leise">{T.tische.zeitplanLeer}</p>
  {:else}
    <p class="ende" data-testid="zeitplan-ende"><strong>{T.tische.ende(uhrzeitText(plan.ende))}</strong></p>
    {#if offeneKonkurrenzen.length > 1}
      <ul class="enden">
        {#each offeneKonkurrenzen as kid (kid)}<li>{T.tische.endeKonkurrenz(z.konkurrenzen[kid]!.einst.name, uhrzeitText(plan.konkurrenzEnde.get(kid)!))}</li>{/each}
      </ul>
    {/if}
    <p class="leise klein">{T.tische.satzMinuten(plan.satzMinuten, plan.gelernt)}</p>
    {#if plan.nichtPlanbar}<p class="meldung info">{T.tische.nichtPlanbar(plan.nichtPlanbar)}</p>{/if}
    <ol class="bahnen">
      {#each plan.tische as b (b.nr)}
        <li class="bahn" data-tisch={b.nr} class:ziel={ziehen?.ziel === b.nr}>
          <strong>{T.tische.zeitplanTisch(b.nr)}</strong>
          <ul>
            {#each b.eintraege.slice(0, 6) as e (e.schluessel)}
              <li class:laeuft={e.laeuft} class:spaeter={!e.spiel}><span class="uhr">{uhrzeitText(e.start)}</span> <span class="wer">{planName(e)}</span></li>
            {/each}
            {#if b.eintraege.length > 6}<li class="leise">{T.tische.zeitplanMehr(b.eintraege.length - 6)}</li>{/if}
          </ul>
        </li>
      {/each}
    </ol>
  {/if}
  {#if leitung}
    <details class="anpassen">
      <summary>{T.tische.anpassen}</summary>
      <div class="raster">
        <div>
          <div class="label-zeile"><label for="zb">{T.tische.beginn}</label><Hilfe text={T.tische.beginnHilfe} /></div>
          <input id="zb" type="time" value={z.beginn ?? ''} onchange={(e) => zeitplanSetzen({ beginn: e.currentTarget.value || null })} />
        </div>
        <div>
          <label for="zs">{T.tische.satzMin}</label>
          <select id="zs" value={z.satzMinuten === null ? '' : String(z.satzMinuten)} onchange={(e) => zeitplanSetzen({ satzMinuten: e.currentTarget.value ? Number(e.currentTarget.value) : null })} data-testid="satz-minuten">
            <option value="">{T.tische.satzMinAuto(gelernt)}</option>
            {#each SATZ_MINUTEN as m (m)}<option value={String(m)}>{T.tische.satzMinWahl(m)}</option>{/each}
          </select>
        </div>
      </div>
    </details>
  {/if}
</details>

{#if ziehen}
  <div class="geist" style="left:{ziehen.x}px; top:{ziehen.y}px" aria-hidden="true">{name(z, ziehen.spiel.a)} – {name(z, ziehen.spiel.b)}</div>
{/if}

<style>
  h2 { display: flex; align-items: center; }
  .geraet summary .marke { margin-left: 8px; }
  .marke.an { color: var(--gruen); border-color: var(--gruen); }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 10px 0; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken span { display: inline-flex; align-items: center; }
  .eingerueckt { margin-left: 32px; }
  .tische { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 10px; }
  .tisch { border: 1px solid var(--linie); border-left: 5px solid var(--gruen); border-radius: 10px; padding: 10px 12px; background: var(--flaeche); min-width: 0; }
  .tisch.frei { border-left-color: var(--blau); }
  .tisch.gesperrt { border-left-color: var(--linie); opacity: 0.7; }
  .kopf { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .kopf strong { font-size: 1.15rem; }
  .marke.frei { color: var(--blau); border-color: var(--blau); }
  .paarung { font-weight: 600; margin-top: 4px; overflow-wrap: anywhere; }
  .klein { font-size: 0.9rem; }
  .knoepfe { margin-top: 8px; }
  .knoepfe button { min-height: 44px; }
  .naechstes { display: flex; gap: 10px; align-items: center; }
  .naechstes button { min-height: 44px; }
  .naechstes.gezogen { opacity: 0.5; }
  .aktionen { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex: none; }
  .aktionen button { white-space: nowrap; }
  @media (max-width: 560px) {
    /* Handy: Knöpfe in eine eigene Zeile unter den Namen, damit nichts umbricht */
    .naechstes { flex-wrap: wrap; }
    .naechstes .wachsen { flex: 1 1 calc(100% - 60px); min-width: 0; }
    .aktionen { flex: 1 1 100%; justify-content: flex-start; padding-left: 54px; }
  }
  .griff { min-width: 44px; padding: 0; font-size: 1.3rem; touch-action: none; cursor: grab; flex: none; }
  .tisch.ziel, .bahn.ziel { outline: 3px solid var(--orange); outline-offset: 2px; }
  .ablage { margin-top: 6px; border: 2px dashed var(--blau); border-radius: 8px; padding: 6px; text-align: center; color: var(--blau); font-weight: 600; }
  .geplant { color: var(--blau); font-weight: 600; }
  .geist {
    position: fixed;
    z-index: 40;
    transform: translate(-50%, -130%);
    pointer-events: none;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--blau);
    color: #fff;
    font-weight: 700;
    box-shadow: 0 6px 20px rgb(0 0 0 / 30%);
    max-width: 80vw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .zeitplan summary { display: flex; align-items: center; font-size: 1.1rem; font-weight: 700; }
  .ende { font-size: 1.1rem; margin: 8px 0 4px; }
  .enden { margin: 0 0 6px; padding-left: 1.2rem; }
  .bahnen { list-style: none; padding: 0; margin: 10px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 10px; }
  .bahn { border: 1px solid var(--linie); border-radius: 10px; padding: 8px 10px; min-width: 0; }
  .bahn ul { list-style: none; margin: 4px 0 0; padding: 0; }
  .bahn li { display: flex; gap: 8px; padding: 3px 0; border-top: 1px solid var(--linie); font-size: 0.92rem; }
  .bahn li:first-child { border-top: 0; }
  .bahn .uhr { font-variant-numeric: tabular-nums; font-weight: 700; flex: none; }
  .bahn .wer { overflow-wrap: anywhere; min-width: 0; }
  .bahn .laeuft .uhr { color: var(--gruen); }
  .bahn .spaeter { color: var(--leise); font-style: italic; }
  .anpassen { margin-top: 12px; }
  .anpassen summary { font-size: 0.95rem; color: var(--blau); }
  .raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 480px) {
    .raster { grid-template-columns: 1fr; }
  }
  .naechstes.wartet strong { color: var(--leise); }
  .aufruf { border: 2px solid var(--blau); }
</style>
