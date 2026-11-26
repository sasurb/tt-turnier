<script lang="ts">
  import { strittigerStand, wertungVorlaeufig } from '../engine/modell';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { fehlerText, turnierZugangErmitteln } from '../app.svelte';
  import type { Rolle } from '@shared/protokoll';
  import { TurnierSitzung } from '../engine/turnier';
  import { berechnen, zurueckgezogen, type TurnierZustand } from '../engine/zustand';
  import { spielErgebnisText, alleSpiele, anstehendeSpiele, name, oeffentlich, platzierungen, rundeVon, sichtbar, tabelle, tische, trostPlaetze } from '../engine/abfragen';
  import { baumRunden, koRunden, rundenName } from '../engine/ko';
  import { gruppeTitel, istSchweizerArt, mitKo, punkteText, type Baum, type KonkurrenzZustand, type Spiel } from '../engine/modell';
  import { istRundenModus, kaiserTabelle, letzteRunde, rundenZahl, schweizerTabelle } from '../engine/runden';
  import { geraetId, gemerktesTurnier } from '../einstellungen';
  import { codeAnzeige } from '../code';
  import { appBasis } from '../zentrale.svelte';
  import { Ansager, ansageText, aufrufeVon, neueAufrufe, type Aufruf } from '../ansage';
  import { liveEinstellungen, setzeLiveEinstellungen, type LiveEinstellungen } from '../live';
  import QrCode from './turnier/QrCode.svelte';

  /**
   * Live-Anzeige für Beamer und Fernseher: zeigt, was Zuschauer sehen dürfen (verdeckte Stände bleiben
   * verdeckt, Namen in der eingestellten Form, keine Schiedsrichter) – auch am Gerät der Leitung.
   * Seiten wechseln von selbst; neue Aufrufe erscheinen groß und werden auf Wunsch angesagt.
   */
  let { id }: { id: string } = $props();

  const lokal = $derived(id.startsWith('l'));
  let sitzung: TurnierSitzung | null = null;
  let roh = $state<TurnierZustand | null>(null);
  let fehler = $state('');
  let laedt = $state(true);
  let offline = $state(false);
  let jetzt = $state(Date.now());
  // svelte-ignore state_referenced_locally
  let e = $state<LiveEinstellungen>(liveEinstellungen(id));
  let menue = $state(false);
  let seite = $state(0);

  /** Name und Datum vom Server (online angelegte Turniere tragen den Namen nicht als Ereignis) */
  let kopf = $state<{ name: string; datum: string | null }>({ name: '', datum: null });
  /** Erst nach dem ersten Abgleich gelten Aufrufe als „neu“ (sonst blinkt beim Öffnen alles auf) */
  let abgeglichen = $state(false);
  const z = $derived(roh ? { ...oeffentlich(roh), name: roh.name || kopf.name, datum: roh.datum ?? kopf.datum } : null);
  const link = $derived(`${appBasis()}#/t/${id}`);

  /** Gleiche Regel wie die Turnieransicht (turnierZugangErmitteln), sonst laden sich zwei Fenster gegenseitig neu */
  let zugang = $state<{ token: string | null; rolle: Rolle | null }>({ token: null, rolle: null });
  function token(): string | null {
    return zugang.token;
  }

  async function aktualisieren() {
    if (!sitzung) return;
    roh = berechnen(await sitzung.ereignisse());
    const st = sitzung.status;
    offline = !!st && (st.verbindung === 'offline' || st.verbindung === 'fehler');
    if (lokal || st?.letzterAbgleich) abgeglichen = true;
  }

  let uhr: ReturnType<typeof setInterval> | undefined;
  let lokalTakt: ReturnType<typeof setInterval> | undefined;
  let wechsel: ReturnType<typeof setInterval> | undefined;
  let wachHalten: { release(): Promise<void> } | null = null;

  async function wachBleiben() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && document.visibilityState === 'visible') wachHalten = await wl.request('screen');
    } catch {
      /* nicht unterstützt */
    }
  }
  function beiSichtbarkeit() {
    if (document.visibilityState === 'visible') {
      void wachBleiben();
      void sitzung?.abgleich?.anstossen();
    }
  }

  onMount(async () => {
    try {
      if (!lokal) {
        const s = await serverPruefen();
        if (s.art !== 'bereit') throw new Error(T.start.keinServer);
        const g = gemerktesTurnier(id);
        kopf = { name: g?.name ?? '', datum: g?.datum ?? null };
        try {
          const info = (await api.turnier(id)).turnier; // gibt es das Turnier?
          kopf = { name: info.name, datum: info.datum };
        } catch (x) {
          if (!g) throw x;
        }
      } else if (!gemerktesTurnier(id)) {
        throw new Error(T.turnier.nichtGefunden);
      }
      zugang = await turnierZugangErmitteln(id);
      sitzung = new TurnierSitzung({
        speicher,
        turnier: id,
        modus: lokal ? 'lokal' : 'online',
        geraet: geraetId(),
        autor: { rolle: 'zuschauer', name: '' },
        api,
        token,
        intervallMs: 3000,
        beiAenderung: () => void aktualisieren(),
        beiRechteVerlust: () => (zugang = { token: null, rolle: null }),
      });
      await aktualisieren();
      sitzung.start();
      // Einzelgerät: Einträge kommen aus einem anderen Fenster desselben Browsers
      if (lokal) lokalTakt = setInterval(() => void aktualisieren(), 3000);
      void wachBleiben();
      document.addEventListener('visibilitychange', beiSichtbarkeit);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
    uhr = setInterval(() => (jetzt = Date.now()), 5000);
  });

  onDestroy(() => {
    sitzung?.stop();
    clearInterval(uhr);
    clearInterval(lokalTakt);
    clearInterval(wechsel);
    clearTimeout(bannerTimer);
    clearTimeout(menueTimer);
    ansager.stoppen();
    void wachHalten?.release().catch(() => undefined);
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
  });

  function einstellen(neu: Partial<LiveEinstellungen>) {
    e = { ...e, ...neu };
    setzeLiveEinstellungen(id, e);
  }

  /* ---------- Seiten ---------- */
  type Seite =
    | { art: 'ablauf' }
    | { art: 'gruppen'; k: KonkurrenzZustand; nrs: number[]; teil: number; von: number }
    | { art: 'rangliste'; k: KonkurrenzZustand }
    | { art: 'baum'; k: KonkurrenzZustand; baum: Baum }
    | { art: 'plaetze'; k: KonkurrenzZustand };

  const seiten = $derived.by<Seite[]>(() => {
    if (!z) return [];
    const aus: Seite[] = [];
    if (e.ablauf) aus.push({ art: 'ablauf' });
    for (const kid of z.konkurrenzReihe) {
      const k = z.konkurrenzen[kid]!;
      if (e.nurKonkurrenz && e.nurKonkurrenz !== kid) continue;
      if (!k.gestartet.gruppen && !k.gestartet.ko) continue;
      const v = sichtbar(z, k);
      if (e.staende && v.tabellen) {
        if (istRundenModus(k.einst.modus)) aus.push({ art: 'rangliste', k });
        else if (k.gruppen.length) {
          const groesste = Math.max(...k.gruppen.map((g) => g.mitglieder.length));
          const jeSeite = groesste <= 5 ? 6 : groesste <= 8 ? 2 : 1;
          const teile = Math.ceil(k.gruppen.length / jeSeite);
          for (let i = 0; i < teile; i++) aus.push({ art: 'gruppen', k, nrs: k.gruppen.slice(i * jeSeite, (i + 1) * jeSeite).map((g) => g.nr), teil: i + 1, von: teile });
        }
      }
      if (e.baeume && v.ko && k.gestartet.ko && mitKo(k.einst.modus)) {
        aus.push({ art: 'baum', k, baum: 'haupt' });
        if (baumRunden(k, 'verlierer')) aus.push({ art: 'baum', k, baum: 'verlierer' }, { art: 'baum', k, baum: 'finale' });
        if (baumRunden(k, 'trost')) aus.push({ art: 'baum', k, baum: 'trost' });
      }
      if (e.staende && v.tabellen && (k.status === 'beendet' || (k.einst.modus === 'gruppen_platz' && platzierungen(k).length > 0)) && !istRundenModus(k.einst.modus)) aus.push({ art: 'plaetze', k });
    }
    if (!aus.length) aus.push({ art: 'ablauf' });
    return aus;
  });
  const aktuell = $derived(seiten[Math.min(seite, seiten.length - 1)] ?? { art: 'ablauf' as const });

  $effect(() => {
    const takt = e.takt;
    clearInterval(wechsel);
    if (takt > 0) wechsel = setInterval(() => (seite = (seite + 1) % Math.max(1, seiten.length)), takt * 1000);
    return () => clearInterval(wechsel);
  });
  function blaettern(d: number) {
    seite = (seite + d + seiten.length) % Math.max(1, seiten.length);
  }

  /* ---------- Ablauf ---------- */
  const laufend = $derived(z ? tische(z).filter((t) => !e.nurKonkurrenz || !t.spiel || t.spiel.konkurrenz === e.nurKonkurrenz) : []);
  const naechste = $derived(z ? anstehendeSpiele(z, jetzt).filter((a) => !e.nurKonkurrenz || a.spiel.konkurrenz === e.nurKonkurrenz).slice(0, 8) : []);
  const ergebnisse = $derived(
    z
      ? alleSpiele(z)
          .filter((s) => (!e.nurKonkurrenz || s.konkurrenz === e.nurKonkurrenz) && s.eintrag && s.ergebnis && s.status === 'gespielt' && !s.gestrichen)
          .sort((a, b) => (a.eintrag!.zeit < b.eintrag!.zeit ? 1 : -1))
          .slice(0, 8)
      : [],
  );
  function ort(s: Spiel) {
    const k = z!.konkurrenzen[s.konkurrenz]!;
    return `${k.einst.name} · ${rundeVon(k, s)}`;
  }
  function minuten(t: string | null) {
    return t ? Math.max(0, Math.floor((jetzt - Date.parse(t)) / 60000)) : 0;
  }
  function frischAufgerufen(s: Spiel) {
    return !!s.aufgerufen && jetzt - Date.parse(s.aufgerufen) < 90_000;
  }

  /* ---------- Neue Aufrufe: groß einblenden und ansagen ---------- */
  const ansager = new Ansager();
  let tonBereit = $state(false);
  let keineStimme = $state(false);
  const bekannt = new Set<string>();
  let warScharf = false;
  let banner = $state<Aufruf[]>([]);
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!z) return;
    const liste = aufrufeVon(z);
    const scharf = abgeglichen;
    untrack(() => {
      const neu = neueAufrufe(bekannt, liste);
      // was beim Öffnen (bis einschließlich zum ersten Abgleich) schon läuft, nicht noch einmal melden
      const eben = scharf && !warScharf;
      warScharf = scharf;
      if (!scharf || eben) return;
      if (!neu.length) return;
      if (e.einblenden) {
        banner = [...banner, ...neu].slice(-4);
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => (banner = []), 12_000);
      }
      if (e.ansage && tonBereit) for (const a of neu) ansager.sagen(ansageText(z!, a));
    });
  });
  async function tonEin(an: boolean) {
    einstellen({ ansage: an });
    if (!an) {
      ansager.stoppen();
      tonBereit = false;
      return;
    }
    tonBereit = await ansager.freischalten();
    keineStimme = !tonBereit;
  }

  /* ---------- Bedienung: Menü blendet sich aus ---------- */
  let menueTimer: ReturnType<typeof setTimeout> | undefined;
  let zeigeKnopf = $state(true);
  function regung() {
    zeigeKnopf = true;
    clearTimeout(menueTimer);
    menueTimer = setTimeout(() => (zeigeKnopf = false), 4000);
  }
  async function vollbild() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* nicht erlaubt */
    }
  }

  function uhrzeit(t: number) {
    return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  function satz(s: Spiel, seite: 'a' | 'b') {
    return s.ergebnis ? String(seite === 'a' ? s.ergebnis.satzA : s.ergebnis.satzB) : '';
  }
  function verein(id: string) {
    return z?.spieler[id]?.verein ?? '';
  }
  /** Baum: bei großen Feldern nur die letzten vier Runden (passt auf eine Seite) */
  function baumSpalten(k: KonkurrenzZustand, baum: Baum) {
    const R = baum === 'haupt' ? (k.auslosungKo ? koRunden(k.auslosungKo.plaetze.length) : 0) : baumRunden(k, baum);
    const ab = Math.max(1, R - 3);
    const spalten: { titel: string; spiele: Spiel[] }[] = [];
    for (let r = ab; r <= R; r++) {
      const spiele = k.reihenfolge.map((sid) => k.spiele[sid]!).filter((s) => s.phase === 'ko' && s.baum === baum && s.runde === r && !s.platz3 && s.status !== 'entfallen');
      spalten.push({ titel: rundenName(r, R, baum), spiele });
    }
    return spalten;
  }
</script>

<svelte:window onpointermove={regung} onpointerdown={regung} onkeydown={(ev) => (ev.key === 'ArrowRight' ? blaettern(1) : ev.key === 'ArrowLeft' ? blaettern(-1) : ev.key === 'Escape' ? (menue = false) : null)} />

<div class="live" data-thema={e.thema} data-groesse={e.groesse} data-testid="live">
  {#if laedt}
    <p class="mitte">{T.app.laden}</p>
  {:else if fehler || !z}
    <div class="mitte">
      <p>{fehler || T.turnier.nichtGefunden}</p>
      <a class="knopf" href={linkZu('')}>{T.app.zurueck}</a>
    </div>
  {:else}
    <header class="leiste">
      <div class="titel">
        <h1>{z.name}</h1>
        <span class="unter">{T.live.untertitel(z.ort, seiten.length > 1 ? `${Math.min(seite, seiten.length - 1) + 1}/${seiten.length}` : '')}</span>
      </div>
      {#if offline}<span class="offline" role="status">{T.live.offline}</span>{/if}
      <span class="uhr">{uhrzeit(jetzt)}</span>
      {#if e.qr && !lokal}
        <div class="qr" aria-label={T.live.qrText}>
          <QrCode text={link} groesse={96} />
          <span>{T.live.qrText}<br /><strong>{codeAnzeige(id)}</strong></span>
        </div>
      {/if}
    </header>

    <main class="flaeche">
      {#if aktuell.art === 'ablauf'}
        <div class="ablauf">
          <section class="block tische-block">
            <h2>{T.live.anDenTischen}</h2>
            {#if laufend.some((t) => t.spiel)}
              <ul class="tisch-raster">
                {#each laufend.filter((t) => t.spiel || !t.gesperrt) as t (t.nr)}
                  <li class="tisch" class:leer={!t.spiel} class:neu={t.spiel && frischAufgerufen(t.spiel)}>
                    <span class="nr">{t.nr}</span>
                    {#if t.spiel}
                      <span class="paar"><span>{name(z, t.spiel.a)}</span><span class="gegen">–</span><span>{name(z, t.spiel.b)}</span></span>
                      <span class="ort">{ort(t.spiel)} · {T.tische.seit(minuten(t.spiel.aufgerufen))}</span>
                    {:else}
                      <span class="paar frei">{T.tische.frei}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="leer-text">{z.konkurrenzReihe.some((kid) => z.konkurrenzen[kid]!.gestartet.gruppen || z.konkurrenzen[kid]!.gestartet.ko) ? T.live.keineTische : T.live.gleich}</p>
            {/if}
          </section>
          <section class="block">
            <h2>{T.live.alsNaechstes}</h2>
            {#if naechste.length}
              <ol class="zeilen">
                {#each naechste as a (a.spiel.konkurrenz + a.spiel.id)}
                  <li class:wartet={!a.bereit}><span class="paar-klein">{name(z, a.spiel.a)} – {name(z, a.spiel.b)}</span><span class="ort">{ort(a.spiel)}</span></li>
                {/each}
              </ol>
            {:else}
              <p class="leer-text">{T.tische.keineNaechsten}</p>
            {/if}
          </section>
          <section class="block">
            <h2>{T.live.ergebnisse}</h2>
            {#if ergebnisse.length}
              <ul class="zeilen">
                {#each ergebnisse as s (s.konkurrenz + s.id)}
                  <li>
                    <span class="paar-klein"><span class:sieger={s.gewinner === 'a'}>{name(z, s.a)}</span> – <span class:sieger={s.gewinner === 'b'}>{name(z, s.b)}</span></span>
                    <span class="erg">{spielErgebnisText(z, s, s.ergebnis!)}{#if strittigerStand(s.stand)} · {T.spiele[s.stand!]} (vorläufig){/if}</span>
                    <span class="ort">{ort(s)}</span>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="leer-text">{T.live.nochKeine}</p>
            {/if}
          </section>
        </div>
      {:else if aktuell.art === 'gruppen'}
        {@const k = aktuell.k}
        <h2 class="seitentitel">{k.einst.name}{#if wertungVorlaeufig(k)} · vorläufig{/if}{aktuell.von > 1 ? ` (${aktuell.teil}/${aktuell.von})` : ''}</h2>
        <div class="gruppen-raster" class:eine={aktuell.nrs.length === 1}>
          {#each aktuell.nrs as nr (nr)}
            {@const t = tabelle(k, nr)}
            <section class="block">
              <h3>{k.gruppen.length > 1 ? gruppeTitel(k, nr) : T.konk.modi.jgj}</h3>
              <table>
                <thead><tr><th class="z">{T.tab.platz}</th><th>{T.tab.spieler}</th><th class="z">{T.tab.sn}</th><th class="z">{T.tab.saetze}</th></tr></thead>
                <tbody>
                  {#each t.zeilen as r (r.id)}
                    <tr class:weiter={k.einst.modus === 'gruppen_ko' && !r.zurueckgezogen && r.platz <= k.einst.aufsteiger} class:raus={r.zurueckgezogen}>
                      <td class="z">{r.platz}</td>
                      <td><span class="name">{name(z, r.id, k)}</span>{#if verein(r.id)}<span class="verein">{verein(r.id)}</span>{/if}</td>
                      <td class="z">{r.siege}:{r.niederlagen}</td>
                      <td class="z">{r.saetzeG}:{r.saetzeV}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </section>
          {/each}
        </div>
      {:else if aktuell.art === 'rangliste'}
        {@const k = aktuell.k}
        {@const zur = zurueckgezogen(k)}
        <h2 class="seitentitel">{k.einst.name}{#if wertungVorlaeufig(k)} · vorläufig{/if} · {T.tab.rundeStand(letzteRunde(k), rundenZahl(k))}</h2>
        <section class="block">
          <table>
            {#if istSchweizerArt(k.einst.modus)}
              <thead><tr><th class="z">{T.tab.platz}</th><th>{T.tab.spieler}</th><th class="z">{T.tab.punkte}</th><th class="z">{T.tab.buchholz}</th><th class="z">{T.tab.saetze}</th></tr></thead>
              <tbody>
                {#each schweizerTabelle(k, zur).slice(0, 16) as r (r.id)}
                  <tr class:raus={r.zurueckgezogen}><td class="z">{r.platz}</td><td><span class="name">{name(z, r.id, k)}</span>{#if verein(r.id)}<span class="verein">{verein(r.id)}</span>{/if}</td><td class="z">{punkteText(r.punkte)}</td><td class="z">{punkteText(r.buchholz)}</td><td class="z">{r.saetzeG}:{r.saetzeV}</td></tr>
                {/each}
              </tbody>
            {:else}
              <thead><tr><th class="z">{T.tab.platz}</th><th>{T.tab.spieler}</th><th class="z">{T.tab.sn}</th><th class="z">{T.tab.kaiserSiege}</th></tr></thead>
              <tbody>
                {#each kaiserTabelle(k, zur).zeilen.slice(0, 16) as r (r.id)}
                  <tr class:raus={r.zurueckgezogen}><td class="z">{r.platz === 1 && !r.zurueckgezogen ? '👑' : r.platz}</td><td><span class="name">{name(z, r.id, k)}</span>{#if verein(r.id)}<span class="verein">{verein(r.id)}</span>{/if}</td><td class="z">{r.siege}:{r.niederlagen}</td><td class="z">{r.kaiserSiege}</td></tr>
                {/each}
              </tbody>
            {/if}
          </table>
        </section>
      {:else if aktuell.art === 'baum'}
        {@const k = aktuell.k}
        <h2 class="seitentitel">{k.einst.name}{#if wertungVorlaeufig(k)} · vorläufig{/if} · {aktuell.baum === 'haupt' ? (k.einst.modus === 'gruppen_ko' ? T.konk.endrunde : T.konk.modi.ko) : T.konk.baeume[aktuell.baum]}</h2>
        <div class="baum">
          {#each baumSpalten(k, aktuell.baum) as sp, i (i)}
            <div class="runde">
              <h3>{sp.titel}</h3>
              <div class="spiele">
                {#each sp.spiele as s (s.id)}
                  <div class="box" class:offen={s.status === 'offen' && s.tisch !== null}>
                    {#each ['a', 'b'] as const as seite (seite)}
                      {@const frei = seite === 'a' ? s.aFrei : s.bFrei}
                      {@const tid = seite === 'a' ? s.a : s.b}
                      <span class="zeile" class:sieger={s.gewinner === seite}><span class="n">{frei ? T.konk.freilos : tid ? name(z, tid, k) : '…'}</span><span class="s">{satz(s, seite)}</span></span>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else if aktuell.art === 'plaetze'}
        {@const k = aktuell.k}
        <h2 class="seitentitel">{k.einst.name}{#if wertungVorlaeufig(k)} · vorläufig{/if} · {T.tab.platzierungen}</h2>
        <section class="block">
          <ol class="plaetze">
            {#each platzierungen(k).slice(0, 8) as x (x.id)}
              <li><span class="pl">{x.bezeichnung}</span> <span class="name">{name(z, x.id, k)}</span> {#if verein(x.id)}<span class="verein-inline">{verein(x.id)}</span>{/if}</li>
            {/each}
          </ol>
          {#if trostPlaetze(k).length}
            <h3>{T.konk.trostPlatzierungen}</h3>
            <ol class="plaetze">
              {#each trostPlaetze(k).slice(0, 4) as x (x.id)}<li><span class="pl">{x.bezeichnung}</span> <span class="name">{name(z, x.id, k)}</span></li>{/each}
            </ol>
          {/if}
        </section>
      {/if}
    </main>

    {#if banner.length}
      <div class="banner" role="alert" data-testid="live-banner">
        <h2>{T.live.aufgerufen}</h2>
        {#each banner as a (a.schluessel)}
          <p><span class="nr">{T.tische.tisch(a.tisch)}</span> {name(z, a.spiel.a)} – {name(z, a.spiel.b)}</p>
        {/each}
      </div>
    {/if}

    <button class="menue-knopf" class:weg={!zeigeKnopf && !menue} onclick={() => (menue = !menue)} aria-expanded={menue} aria-label={T.live.einstellungen} data-testid="live-menue">⚙</button>
    {#if menue}
      <div class="menue" role="dialog" aria-label={T.live.einstellungen}>
        <h2>{T.live.einstellungen}</h2>
        <p class="hinweis">{T.live.hinweis}</p>
        <label for="lt">{T.live.takt}</label>
        <select id="lt" value={e.takt} onchange={(ev) => einstellen({ takt: Number(ev.currentTarget.value) })}>
          {#each [0, 10, 15, 20, 30, 60] as t (t)}<option value={t}>{t === 0 ? T.live.taktAus : T.live.taktSek(t)}</option>{/each}
        </select>
        <label for="lk">{T.live.konkurrenz}</label>
        <select id="lk" value={e.nurKonkurrenz} onchange={(ev) => einstellen({ nurKonkurrenz: ev.currentTarget.value })}>
          <option value="">{T.live.alleKonkurrenzen}</option>
          {#each z.konkurrenzReihe as kid (kid)}<option value={kid}>{z.konkurrenzen[kid]!.einst.name}</option>{/each}
        </select>
        <fieldset>
          <legend>{T.live.zeigen}</legend>
          <label class="haken"><input type="checkbox" checked={e.ablauf} onchange={(ev) => einstellen({ ablauf: ev.currentTarget.checked })} /> {T.live.zeigeAblauf}</label>
          <label class="haken"><input type="checkbox" checked={e.staende} onchange={(ev) => einstellen({ staende: ev.currentTarget.checked })} /> {T.live.zeigeStaende}</label>
          <label class="haken"><input type="checkbox" checked={e.baeume} onchange={(ev) => einstellen({ baeume: ev.currentTarget.checked })} /> {T.live.zeigeBaeume}</label>
          <label class="haken"><input type="checkbox" checked={e.einblenden} onchange={(ev) => einstellen({ einblenden: ev.currentTarget.checked })} /> {T.live.zeigeAufrufe}</label>
          {#if !lokal}<label class="haken"><input type="checkbox" checked={e.qr} onchange={(ev) => einstellen({ qr: ev.currentTarget.checked })} /> {T.live.zeigeQr}</label>{/if}
        </fieldset>
        <label class="haken"><input type="checkbox" checked={e.ansage && tonBereit} onchange={(ev) => tonEin(ev.currentTarget.checked)} data-testid="live-ansage" /> {T.tische.ansage}</label>
        {#if keineStimme}<p class="hinweis">{T.tische.keineStimme}</p>{/if}
        <label for="lth">{T.live.thema}</label>
        <select id="lth" value={e.thema} onchange={(ev) => einstellen({ thema: ev.currentTarget.value as LiveEinstellungen['thema'] })}>
          <option value="hell">{T.live.hell}</option>
          <option value="dunkel">{T.live.dunkel}</option>
        </select>
        <label for="lg">{T.live.groesse}</label>
        <select id="lg" value={e.groesse} onchange={(ev) => einstellen({ groesse: ev.currentTarget.value as LiveEinstellungen['groesse'] })}>
          <option value="normal">{T.live.normal}</option>
          <option value="gross">{T.live.gross}</option>
        </select>
        <div class="knoepfe">
          <button onclick={vollbild}>{T.live.vollbild}</button>
          <button class="zweit" onclick={() => blaettern(1)}>{T.live.weiter}</button>
          <a class="knopf zweit" href={linkZu(`t/${id}`)}>{T.live.verlassen}</a>
          <button class="zweit" onclick={() => (menue = false)}>{T.app.schliessen}</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .live {
    --l-grund: #ffffff;
    --l-flaeche: #f1f4f8;
    --l-text: #0b1220;
    --l-leise: #3d4a5c;
    --l-linie: #c9d1dc;
    --l-akzent: #1450a3;
    --l-gruen: #12703c;
    --l-neu: #fff1c2;
    --l-schrift: clamp(15px, 1.35vw, 30px);
    position: fixed;
    inset: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    background: var(--l-grund);
    color: var(--l-text);
    font-size: var(--l-schrift);
    line-height: 1.3;
    z-index: 50;
  }
  .live[data-groesse='gross'] { --l-schrift: clamp(17px, 1.7vw, 38px); }
  .live[data-thema='dunkel'] {
    --l-grund: #05080d;
    --l-flaeche: #121a26;
    --l-text: #f5f8fc;
    --l-leise: #b5c2d3;
    --l-linie: #2b3747;
    --l-akzent: #7db3ff;
    --l-gruen: #5fe39a;
    --l-neu: #3a3000;
  }
  .mitte { margin: auto; text-align: center; }
  .leiste { display: flex; align-items: center; gap: 1.2em; padding: 0.6em 1.2em; border-bottom: 3px solid var(--l-akzent); }
  .titel { flex: 1; min-width: 0; }
  .titel h1 { font-size: 1.7em; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unter { color: var(--l-leise); font-size: 0.85em; }
  .uhr { font-size: 1.8em; font-weight: 700; font-variant-numeric: tabular-nums; }
  .offline { background: #b3261e; color: #fff; padding: 0.2em 0.6em; border-radius: 0.4em; font-weight: 700; font-size: 0.8em; }
  .qr { display: flex; align-items: center; gap: 0.6em; font-size: 0.7em; color: var(--l-leise); }
  .qr :global(svg), .qr :global(img), .qr :global(canvas) { background: #fff; padding: 4px; border-radius: 6px; width: 4.8em !important; height: 4.8em !important; }
  .qr strong { color: var(--l-text); font-family: ui-monospace, monospace; letter-spacing: 0.08em; }
  .flaeche { flex: 1; padding: 0.8em 1.2em 1.2em; min-height: 0; }
  h2 { font-size: 1.15em; margin: 0 0 0.5em; color: var(--l-akzent); text-transform: uppercase; letter-spacing: 0.04em; }
  h3 { font-size: 1em; margin: 0 0 0.4em; }
  .seitentitel { font-size: 1.4em; text-transform: none; letter-spacing: 0; color: var(--l-text); }
  .block { background: var(--l-flaeche); border: 1px solid var(--l-linie); border-radius: 0.6em; padding: 0.7em 0.9em; min-width: 0; }
  .ablauf { display: grid; grid-template-columns: 1.5fr 1fr; grid-template-rows: auto 1fr; gap: 0.9em; }
  .tische-block { grid-row: span 2; }
  .tisch-raster { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16em, 1fr)); gap: 0.5em; }
  .tisch { display: grid; grid-template-columns: 2.4em 1fr; grid-template-rows: auto auto; column-gap: 0.6em; align-items: center; padding: 0.5em 0.7em; border-radius: 0.5em; background: var(--l-grund); border: 2px solid var(--l-linie); }
  .tisch.neu { background: var(--l-neu); border-color: #e0a800; animation: blinken 1.2s ease-in-out 3; }
  .tisch.leer { opacity: 0.55; }
  .tisch .nr { grid-row: span 2; font-size: 1.8em; font-weight: 800; text-align: center; color: var(--l-akzent); }
  .paar { font-weight: 700; display: flex; flex-wrap: wrap; gap: 0 0.35em; overflow-wrap: anywhere; }
  .paar.frei { font-weight: 400; color: var(--l-leise); }
  .gegen { color: var(--l-leise); }
  .ort { display: block; color: var(--l-leise); font-size: 0.78em; }
  .zeilen { list-style: none; margin: 0; padding: 0; }
  .zeilen li { padding: 0.35em 0; border-top: 1px solid var(--l-linie); display: flex; flex-wrap: wrap; gap: 0 0.6em; align-items: baseline; }
  .zeilen li:first-child { border-top: 0; }
  .zeilen li.wartet { opacity: 0.65; }
  ol.zeilen { counter-reset: n; }
  .paar-klein { font-weight: 600; flex: 1 1 60%; min-width: 0; overflow-wrap: anywhere; }
  .erg { font-variant-numeric: tabular-nums; font-weight: 700; }
  .sieger { color: var(--l-gruen); font-weight: 800; }
  .leer-text { color: var(--l-leise); }
  .gruppen-raster { display: grid; grid-template-columns: repeat(auto-fit, minmax(22em, 1fr)); gap: 0.8em; }
  .gruppen-raster.eine { grid-template-columns: 1fr; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.3em 0.4em; border-bottom: 1px solid var(--l-linie); text-align: left; vertical-align: top; }
  th { font-size: 0.75em; color: var(--l-leise); }
  .z { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { font-weight: 700; }
  .verein { display: block; font-size: 0.72em; color: var(--l-leise); }
  .verein-inline { color: var(--l-leise); font-size: 0.8em; }
  tr.weiter td:first-child { box-shadow: inset 0.3em 0 0 var(--l-gruen); }
  tr.raus { opacity: 0.55; }
  .baum { display: flex; gap: 0.8em; height: calc(100% - 2.4em); min-height: 60vh; }
  .runde { flex: 1 1 0; display: flex; flex-direction: column; min-width: 0; }
  .runde h3 { color: var(--l-leise); font-size: 0.85em; }
  .spiele { display: flex; flex-direction: column; justify-content: space-around; flex: 1; gap: 0.4em; }
  .box { border: 2px solid var(--l-linie); border-radius: 0.4em; background: var(--l-flaeche); overflow: hidden; }
  .box.offen { border-color: var(--l-akzent); }
  .zeile { display: flex; justify-content: space-between; gap: 0.4em; padding: 0.2em 0.5em; font-size: 0.9em; }
  .zeile + .zeile { border-top: 1px solid var(--l-linie); }
  .zeile.sieger { color: var(--l-gruen); font-weight: 800; }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plaetze { list-style: none; margin: 0; padding: 0; font-size: 1.3em; }
  .plaetze li { padding: 0.3em 0; border-bottom: 1px solid var(--l-linie); }
  .pl { display: inline-block; min-width: 3.2em; font-weight: 800; color: var(--l-akzent); }
  .banner { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(90vw, 40em); background: var(--l-neu); color: var(--l-text); border: 4px solid #e0a800; border-radius: 1em; padding: 1em 1.4em; box-shadow: 0 1em 3em rgb(0 0 0 / 35%); z-index: 60; font-size: 1.4em; }
  .banner h2 { color: inherit; }
  .banner p { margin: 0.3em 0; font-weight: 800; display: grid; grid-template-columns: 5em 1fr; gap: 0.5em; }
  .banner .nr { color: var(--l-akzent); }
  .menue-knopf { position: fixed; right: 1em; bottom: 1em; width: 56px; height: 56px; min-height: 56px; border-radius: 50%; font-size: 26px; padding: 0; background: var(--l-akzent); color: #fff; z-index: 70; transition: opacity 0.3s; }
  .menue-knopf.weg { opacity: 0; }
  .menue { position: fixed; right: 1em; bottom: 5em; width: min(92vw, 24rem); max-height: calc(100dvh - 7em); overflow: auto; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); border-radius: 12px; padding: 16px; z-index: 70; font-size: 16px; box-shadow: 0 8px 30px rgb(0 0 0 / 30%); }
  .menue h2 { color: var(--text); text-transform: none; font-size: 1.2rem; }
  .hinweis { font-size: 0.9rem; color: var(--leise); }
  .menue .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 6px 0; min-height: 44px; }
  .menue .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .knoepfe { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  @keyframes blinken { 50% { filter: brightness(1.15); transform: scale(1.02); } }
  @media (max-width: 760px), (orientation: portrait) {
    .live { --l-schrift: 16px; }
    .leiste { flex-wrap: wrap; gap: 0.5em 1em; }
    .titel h1 { font-size: 1.35em; white-space: normal; }
    .qr { display: none; }
    .ablauf { grid-template-columns: 1fr; }
    .tische-block { grid-row: auto; }
    .tisch-raster { grid-template-columns: 1fr; }
    .gruppen-raster { grid-template-columns: 1fr; }
    .baum { overflow-x: auto; min-height: 0; height: auto; }
    .runde { min-width: 10em; }
    .banner { font-size: 1.15em; }
    .banner p { grid-template-columns: 1fr; gap: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .tisch.neu { animation: none; } }
</style>
