<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { T } from '../texte';
  import { linkZu, ersetze } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { fehlerText, turnierZugangErmitteln } from '../app.svelte';
  import type { Rolle } from '@shared/protokoll';
  import { TurnierSitzung } from '../engine/turnier';
  import { berechnen, spielerVon, type TurnierZustand } from '../engine/zustand';
  import { anstehendeSpiele, endstand, name, nameLang, platzText, rundeVon, sichtbar, tabelle, trostPlaetze, vorgabeVon } from '../engine/abfragen';
  import { baumRunden, koRunden, rundenName } from '../engine/ko';
  import { einstFuer, gruppeTitel, istSchweizerArt, mitKo, punkteText, type Baum, type KonkurrenzZustand, type Spiel } from '../engine/modell';
  import { istRundenModus, kaiserTabelle, letzteRunde, schweizerTabelle } from '../engine/runden';
  import { ergebnisText } from '../engine/ergebnis';
  import { zurueckgezogen } from '../engine/zustand';
  import { geraetId, gemerktesTurnier } from '../einstellungen';
  import { codeAnzeige } from '../code';
  import { appBasis } from '../zentrale.svelte';
  import { seiteDrucken } from '../nativ';
  import { druckEinstellungen, setzeDruckEinstellungen, type DruckEinstellungen, DRUCK_ARTEN, type DruckArt } from '../druck';
  import QrCode from './turnier/QrCode.svelte';
  import { aufstellungenKomplett, positionsName, systemVon, teileVon, zwischenstand } from '../engine/mannschaft';
  import Hilfe from './Hilfe.svelte';
  import { euro } from '../engine/modell';
  import { enthalteneUst, kassenListe, kassenSumme, postenVon, quittungsNr } from '../engine/kasse';

  /**
   * Druckvorlagen: Spielzettel, Gruppenblätter, Turnierbaum, Ergebnisliste, Teilnehmerliste,
   * Aushang mit QR-Code und Urkunden. „Als PDF speichern“ geht über den Druckdialog
   * (Browser bzw. Android in der Zentrale).
   */
  let { id, art = '', param = null }: { id: string; art?: string; param?: string | null } = $props();
  /** Kassenliste und Quittungen (nur Leitung und Helfer – volle Sicht) */
  const kassenArt = $derived<'kasse' | 'quittungen' | 'praemien' | null>(art === 'kasse' || art === 'quittungen' || art === 'praemien' ? art : null);
  /** Spielberichtsbogen für Mannschafts-Begegnungen (param „<konkurrenz>~<spiel>“ = nur diese Begegnung) */
  const berichtArt = $derived(art === 'spielbericht');

  const lokal = $derived(id.startsWith('l'));
  let sitzung: TurnierSitzung | null = null;
  let z = $state<TurnierZustand | null>(null);
  let fehler = $state('');
  let laedt = $state(true);
  // svelte-ignore state_referenced_locally
  let e = $state<DruckEinstellungen>(druckEinstellungen(id));
  const aktiv = $derived<DruckArt>((DRUCK_ARTEN as readonly string[]).includes(art) ? (art as DruckArt) : 'spielzettel');
  let logoFehler = $state('');

  /** Gleiche Regel wie die Turnieransicht (turnierZugangErmitteln), sonst laden sich zwei Fenster gegenseitig neu */
  let zugang = $state<{ token: string | null; rolle: Rolle | null }>({ token: null, rolle: null });
  function token(): string | null {
    return zugang.token;
  }
  /** Leitung und Helfer sehen alles; sonst bleiben verdeckte Stände verdeckt */
  const allesSichtbar = $derived(lokal || zugang.rolle === 'leitung' || zugang.rolle === 'admin' || zugang.rolle === 'veranstalter' || zugang.rolle === 'helfer');

  let kopf = { name: '', datum: null as string | null };
  async function aktualisieren() {
    if (!sitzung) return;
    const r = berechnen(await sitzung.ereignisse());
    z = { ...r, name: r.name || kopf.name, datum: r.datum ?? kopf.datum };
  }
  onMount(async () => {
    try {
      if (!lokal) {
        const s = await serverPruefen();
        if (s.art !== 'bereit') throw new Error(T.start.keinServer);
        const g = gemerktesTurnier(id);
        kopf = { name: g?.name ?? '', datum: g?.datum ?? null };
        try {
          const info = (await api.turnier(id)).turnier;
          kopf = { name: info.name, datum: info.datum };
        } catch (x) {
          if (!g) throw x;
        }
      } else if (!gemerktesTurnier(id)) throw new Error(T.turnier.nichtGefunden);
      zugang = await turnierZugangErmitteln(id);
      sitzung = new TurnierSitzung({
        speicher,
        turnier: id,
        modus: lokal ? 'lokal' : 'online',
        geraet: geraetId(),
        autor: { rolle: 'zuschauer', name: '' },
        api,
        token,
        intervallMs: 5000,
        beiAenderung: () => void aktualisieren(),
        beiRechteVerlust: () => (zugang = { token: null, rolle: null }),
      });
      await aktualisieren();
      sitzung.start();
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
  });
  onDestroy(() => sitzung?.stop());

  function einstellen(neu: Partial<DruckEinstellungen>) {
    e = { ...e, ...neu };
    setzeDruckEinstellungen(id, e);
  }
  function artWaehlen(a: string) {
    ersetze(`druck/${id}/${a}`);
  }

  async function logoWaehlen(ev: Event) {
    logoFehler = '';
    const f = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
      logoFehler = T.druck.logoTyp;
      return;
    }
    if (f.size > 400_000) {
      logoFehler = T.druck.logoGross;
      return;
    }
    const url = await new Promise<string>((ok, nein) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => nein(r.error);
      r.readAsDataURL(f);
    });
    einstellen({ logo: url });
  }

  /* ---------- Auswahl ---------- */
  const konkurrenzen = $derived(z ? z.konkurrenzReihe.map((k) => z!.konkurrenzen[k]!).filter((k) => !e.konkurrenz || k.id === e.konkurrenz) : []);
  const gestartet = $derived(konkurrenzen.filter((k) => k.gestartet.gruppen || k.gestartet.ko));
  function zeige(k: KonkurrenzZustand) {
    return allesSichtbar ? { tabellen: true, ko: true } : sichtbar(z!, k);
  }

  /* Spielzettel */
  const zettel = $derived.by<Spiel[]>(() => {
    if (!z) return [];
    const alle = konkurrenzen.flatMap((k) => k.reihenfolge.map((sid) => k.spiele[sid]!));
    if (e.zettel === 'aufgerufen') return alle.filter((s) => s.status === 'offen' && s.tisch !== null && !s.eintrag);
    if (e.zettel === 'naechste') {
      const ids = new Set(konkurrenzen.map((k) => k.id));
      return anstehendeSpiele(z)
        .map((a) => a.spiel)
        .filter((s) => ids.has(s.konkurrenz))
        .slice(0, e.zettelAnzahl);
    }
    return alle.filter((s) => s.status === 'offen' && !s.eintrag);
  });
  function spielLink(s: Spiel) {
    return `${appBasis()}#/t/${id}/spiel/${s.konkurrenz}/${s.id}`;
  }
  function verein(k: KonkurrenzZustand, t: string | null) {
    return [...new Set(spielerVon(k, t).map((sid) => z!.spieler[sid]?.verein ?? '').filter(Boolean))].join(' / ');
  }

  /* Gruppen: Kreuztabelle */
  function kreuz(k: KonkurrenzZustand, nr: number, a: string, b: string): string {
    const s = Object.values(k.spiele).find((x) => x.phase === 'gruppen' && x.gruppe === nr && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    if (!s || !s.ergebnis) return '';
    const ausA = s.a === a;
    const t = ausA ? `${s.ergebnis.satzA}:${s.ergebnis.satzB}` : `${s.ergebnis.satzB}:${s.ergebnis.satzA}`;
    return s.gestrichen ? `(${t})` : t;
  }

  /* Baum: große Felder in Teile (obere/untere Hälfte …) und eine Seite für die Endrunde */
  function baumTeile(k: KonkurrenzZustand, baum: Baum) {
    const R = baum === 'haupt' ? (k.auslosungKo ? koRunden(k.auslosungKo.plaetze.length) : 0) : baumRunden(k, baum);
    const runde = (r: number) => k.reihenfolge.map((sid) => k.spiele[sid]!).filter((s) => s.phase === 'ko' && s.baum === baum && s.runde === r && !s.platz3 && s.status !== 'entfallen');
    const n1 = runde(1).length;
    const teile = n1 > 32 ? 4 : n1 > 16 ? 2 : 1;
    const aus: { titel: string; spalten: { titel: string; spiele: Spiel[] }[] }[] = [];
    for (let p = 0; p < teile; p++) {
      const spalten: { titel: string; spiele: Spiel[] }[] = [];
      for (let r = 1; r <= R; r++) {
        const l = runde(r);
        if (teile > 1 && l.length < teile) break;
        const je = l.length / teile;
        spalten.push({ titel: rundenName(r, R, baum), spiele: l.slice(p * je, (p + 1) * je) });
      }
      aus.push({ titel: teile > 1 ? T.druck.teil(p + 1, teile) : '', spalten });
    }
    if (teile > 1) {
      const spalten: { titel: string; spiele: Spiel[] }[] = [];
      for (let r = 1; r <= R; r++) if (runde(r).length < teile) spalten.push({ titel: rundenName(r, R, baum), spiele: runde(r) });
      aus.push({ titel: T.druck.endrunde, spalten });
    }
    return aus;
  }
  function baeume(k: KonkurrenzZustand): Baum[] {
    if (!k.gestartet.ko || !mitKo(k.einst.modus)) return [];
    return ['haupt', ...(baumRunden(k, 'verlierer') ? (['verlierer', 'finale'] as const) : []), ...(baumRunden(k, 'trost') ? (['trost'] as const) : [])];
  }
  function satz(s: Spiel, seite: 'a' | 'b') {
    return s.ergebnis ? String(seite === 'a' ? s.ergebnis.satzA : s.ergebnis.satzB) : '';
  }

  /* Teilnehmer */
  const teilnehmer = $derived.by(() => {
    if (!z) return [];
    const ids = z.spielerReihe.filter((sid) => !e.konkurrenz || konkurrenzen.some((k) => k.meldungen.some((m) => m === sid || k.paare[m]?.spieler.includes(sid))));
    const l = ids.map((sid) => z!.spieler[sid]!);
    return e.sortierung === 'verein'
      ? l.sort((a, b) => a.verein.localeCompare(b.verein, 'de') || a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'))
      : l.sort((a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'));
  });
  function konkVon(sid: string) {
    return z!.konkurrenzReihe
      .filter((kid) => z!.konkurrenzen[kid]!.meldungen.some((m) => m === sid || z!.konkurrenzen[kid]!.paare[m]?.spieler.includes(sid)))
      .map((kid) => z!.konkurrenzen[kid]!.einst.name)
      .join(', ');
  }

  /* Urkunden */
  const urkunden = $derived.by(() => {
    if (!z) return [];
    const aus: { k: KonkurrenzZustand; id: string; platz: string; zusatz: string }[] = [];
    for (const k of konkurrenzen) {
      if (!zeige(k).tabellen) continue;
      for (const p of endstand(k).filter((x) => x.platz <= e.urkundePlaetze)) aus.push({ k, id: p.id, platz: platzText(p.bezeichnung), zusatz: '' });
      if (e.urkundeTrost) for (const p of trostPlaetze(k).filter((x) => x.platz <= 3)) aus.push({ k, id: p.id, platz: platzText(p.bezeichnung), zusatz: T.konk.baeume.trost ?? '' });
    }
    return aus;
  });
  function datum(d: string | null) {
    return d ? new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  /* Kasse */
  const kassenZeilen = $derived(z && kassenArt ? kassenListe(z).filter((x) => x.soll || x.bezahlt || x.erlassen) : []);
  const summe = $derived(z && kassenArt ? kassenSumme(z) : null);
  const quittungen = $derived(
    z && kassenArt === 'quittungen' ? z.buchungen.filter((b) => b.art !== 'erlassen' && (param ? b.id === param : !b.storniert)) : [],
  );
  /** Ab 0.18: Belege der Prämienauszahlungen */
  const auszahlungen = $derived(z && kassenArt === 'praemien' ? z.auszahlungen.filter((a) => (param ? a.id === param : !a.storniert)) : []);
  function zeitpunkt(iso: string) {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }
  const titel = $derived(z ? `${berichtArt ? T.druck.spielberichte : kassenArt ? T.druck.kasseArten[kassenArt] : T.druck.arten[aktiv]} – ${z.name}` : T.druck.titel);
  const mitMannschaften = $derived(!!z && z.konkurrenzReihe.some((k) => z!.konkurrenzen[k]!.einst.art === 'mannschaft'));
  const berichte = $derived.by(() => {
    if (!z || !berichtArt) return [] as { k: KonkurrenzZustand; s: Spiel }[];
    const [kid, sid] = param ? decodeURIComponent(param).split('~') : [null, null];
    const aus: { k: KonkurrenzZustand; s: Spiel }[] = [];
    for (const id of z.konkurrenzReihe) {
      const k = z.konkurrenzen[id]!;
      if (k.einst.art !== 'mannschaft' || (kid && kid !== id)) continue;
      for (const spid of k.reihenfolge) {
        const s = k.spiele[spid]!;
        if (sid && sid !== spid) continue;
        if (s.a && s.b && (s.status === 'offen' || s.status === 'gespielt')) aus.push({ k, s });
      }
    }
    return aus;
  });
  $effect(() => {
    document.title = titel;
    return () => (document.title = T.app.titel);
  });
</script>

{#if laedt}
  <p class="leise mitte">{T.app.laden}</p>
{:else if fehler || !z}
  <div class="mitte">
    <p>{fehler || T.turnier.nichtGefunden}</p>
    <a class="knopf" href={linkZu('')}>{T.app.zurueck}</a>
  </div>
{:else}
  <div class="werkzeug" data-testid="druck-werkzeug">
    <div class="reihe">
      <a class="knopf zweit" href={linkZu(`t/${id}/${kassenArt ? 'kasse' : berichtArt && param ? 'spiele' : 'drucken'}`)}>← {T.app.zurueck}</a>
      <strong class="wachsen">{z.name}</strong>
      <button onclick={() => seiteDrucken(titel)} data-testid="drucken">{T.druck.drucken}</button>
    </div>
    <div class="optionen">
      <div>
        <label for="da">{T.druck.was}</label>
        <select id="da" value={berichtArt ? 'spielbericht' : (kassenArt ?? aktiv)} onchange={(ev) => artWaehlen(ev.currentTarget.value)} data-testid="druck-art">
          {#each DRUCK_ARTEN as a (a)}<option value={a}>{T.druck.arten[a]}</option>{/each}
          {#if mitMannschaften}<option value="spielbericht">{T.druck.spielberichte}</option>{/if}
          {#if allesSichtbar && z.buchungen.length + z.konkurrenzReihe.filter((k) => z!.konkurrenzen[k]!.einst.startgeld).length > 0}
            <option value="kasse">{T.druck.kasseArten.kasse}</option>
            <option value="quittungen">{T.druck.kasseArten.quittungen}</option>
          {/if}
          {#if allesSichtbar && z.auszahlungen.length}<option value="praemien">{T.druck.kasseArten.praemien}</option>{/if}
        </select>
      </div>
      {#if kassenArt || berichtArt}
        <!-- keine weiteren Optionen -->
      {:else if aktiv !== 'aushang'}
        <div>
          <label for="dk">{T.druck.konkurrenz}</label>
          <select id="dk" value={e.konkurrenz} onchange={(ev) => einstellen({ konkurrenz: ev.currentTarget.value })}>
            <option value="">{T.live.alleKonkurrenzen}</option>
            {#each z.konkurrenzReihe as kid (kid)}<option value={kid}>{z.konkurrenzen[kid]!.einst.name}</option>{/each}
          </select>
        </div>
      {/if}
      {#if kassenArt || berichtArt}
        <!-- Kassenliste und Quittungen: keine weiteren Optionen -->
      {:else if aktiv === 'spielzettel'}
        <div>
          <label for="dz">{T.druck.welche}</label>
          <select id="dz" value={e.zettel} onchange={(ev) => einstellen({ zettel: ev.currentTarget.value as DruckEinstellungen['zettel'] })}>
            <option value="aufgerufen">{T.druck.zettelAufgerufen}</option>
            <option value="naechste">{T.druck.zettelNaechste(e.zettelAnzahl)}</option>
            <option value="offen">{T.druck.zettelOffen}</option>
          </select>
        </div>
      {:else if aktiv === 'teilnehmer'}
        <div>
          <label for="ds">{T.druck.sortierung}</label>
          <select id="ds" value={e.sortierung} onchange={(ev) => einstellen({ sortierung: ev.currentTarget.value as DruckEinstellungen['sortierung'] })}>
            <option value="name">{T.druck.nachName}</option>
            <option value="verein">{T.druck.nachVerein}</option>
          </select>
        </div>
      {:else if aktiv === 'urkunden'}
        <div>
          <label for="dp">{T.druck.plaetze}</label>
          <select id="dp" value={e.urkundePlaetze} onchange={(ev) => einstellen({ urkundePlaetze: Number(ev.currentTarget.value) })}>
            {#each [1, 2, 3, 4, 8] as n (n)}<option value={n}>{T.druck.plaetzeBis(n)}</option>{/each}
          </select>
        </div>
        <div>
          <label for="du">{T.druck.unterschrift}</label>
          <input id="du" value={e.unterschrift} maxlength="80" oninput={(ev) => einstellen({ unterschrift: ev.currentTarget.value })} placeholder={T.druck.unterschriftPlatz} />
        </div>
        <div class="voll">
          <label class="haken"><input type="checkbox" checked={e.urkundeTrost} onchange={(ev) => einstellen({ urkundeTrost: ev.currentTarget.checked })} /> {T.druck.trostUrkunden}</label>
          <div class="label-zeile"><label for="dl">{T.druck.logo}</label><Hilfe text={T.druck.logoHilfe} /></div>
          <div class="reihe">
            <input id="dl" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={logoWaehlen} />
            {#if e.logo}<button class="zweit klein" onclick={() => einstellen({ logo: '' })}>{T.druck.logoWeg}</button>{/if}
          </div>
          {#if logoFehler}<p class="meldung fehler">{logoFehler}</p>{/if}
        </div>
      {/if}
    </div>
    <p class="leise tipp">{kassenArt ? T.druck.kasseTipp[kassenArt] : T.druck.tipp[aktiv]}</p>
  </div>

  <div class="dokument" data-art={berichtArt ? 'spielbericht' : (kassenArt ?? aktiv)} data-testid="druck-dokument">
    {#if berichtArt}
      {#if !berichte.length}<p class="leise">{T.druck.keineBegegnungen}</p>{/if}
      {#each berichte as { k, s } (`${k.id}/${s.id}`)}
        {@const ek = einstFuer(k, s)}
        {@const sys = systemVon(ek)}
        {@const teile = teileVon(k, s)}
        {@const st = zwischenstand(teile)}
        {@const offen = allesSichtbar || aufstellungenKomplett(k, s)}
        <section class="seite bericht" data-testid="spielbericht">
          <h1>{T.druck.spielbericht}</h1>
          <p class="unter">{z.name}{z.datum ? ` · ${datum(z.datum)}` : ''} · {k.einst.name} · {rundeVon(k, s)}{s.tisch ? ` · ${T.spiele.tisch(s.tisch, s.tisch2)}` : ''} · {sys.name}</p>
          <div class="teams">
            {#each ['a', 'b'] as const as seite (seite)}
              {@const tid = seite === 'a' ? s.a : s.b}
              {@const auf = tid ? k.begegnungen[s.id]?.aufstellung[tid] : undefined}
              <div>
                <h2>{seite === 'a' ? T.druck.heim : T.druck.gast}: {name(z, tid, k)}</h2>
                <table class="aufst">
                  <tbody>
                    {#each Array.from({ length: sys.einzel }, (_, i) => i) as i (i)}
                      <tr><td class="pos">{positionsName(sys, 'einzel', seite, i + 1)}</td><td>{offen && auf?.einzel[i] ? nameLang(z, auf.einzel[i]!) : ''}</td></tr>
                    {/each}
                    {#each Array.from({ length: sys.doppel }, (_, i) => i) as i (i)}
                      <tr><td class="pos">D{i + 1}</td><td>{offen && auf?.doppel[i] ? auf.doppel[i]!.map((x) => nameLang(z!, x)).join(' / ') : ''}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
          <table class="teiltab">
            <thead>
              <tr>
                <th>#</th><th>{T.druck.paarung}</th><th>{T.druck.heim}</th><th>{T.druck.gast}</th>
                {#each Array.from({ length: ek.bestOf }, (_, i) => i) as i (i)}<th class="z">{i + 1}</th>{/each}
                <th class="z">{T.druck.saetze}</th><th class="z">{T.druck.spieleSpalte}</th>
              </tr>
            </thead>
            <tbody>
              {#each teile as t (t.id)}
                <tr>
                  <td>{t.nr}</td>
                  <td>{positionsName(sys, t.art, 'a', t.posA)}–{positionsName(sys, t.art, 'b', t.posB)}</td>
                  <td>{offen ? t.a.map((x) => nameLang(z!, x)).join(' / ') : ''}</td>
                  <td>{offen ? t.b.map((x) => nameLang(z!, x)).join(' / ') : ''}</td>
                  {#each Array.from({ length: ek.bestOf }, (_, i) => i) as i (i)}<td class="z">{t.ergebnis?.saetze?.[i] ? `${t.ergebnis.saetze[i]![0]}:${t.ergebnis.saetze[i]![1]}` : ''}</td>{/each}
                  <td class="z">{t.ergebnis ? `${t.ergebnis.satzA}:${t.ergebnis.satzB}` : t.status === 'entfallen' ? '–' : ''}</td>
                  <td class="z">{t.gewinner === 'a' ? '1:0' : t.gewinner === 'b' ? '0:1' : ''}</td>
                </tr>
              {/each}
              <tr class="summe"><td colspan={4 + ek.bestOf}>{T.druck.endstand}</td><td class="z">{st.satzA}:{st.satzB}</td><td class="z"><strong>{st.siegeA}:{st.siegeB}</strong></td></tr>
            </tbody>
          </table>
          <div class="unterschriften">
            <div>{T.druck.unterschriftHeim}</div>
            <div>{T.druck.unterschriftGast}</div>
            <div>{T.druck.unterschriftLeitung}</div>
          </div>
        </section>
      {/each}
    {:else if kassenArt === 'kasse' && summe}
      <section class="seite">
        <h1>{T.druck.kasseArten.kasse}</h1>
        <p class="unter">{z.name}{z.datum ? ` · ${datum(z.datum)}` : ''} · {T.druck.standAm(new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
        <table class="kassentab">
          <thead><tr><th>{T.druck.spieler}</th><th>{T.kasse.checkin}</th><th class="z">{T.kasse.soll}</th><th class="z">{T.kasse.arten.bar}</th><th class="z">{T.kasse.arten.ueberweisung}</th><th class="z">{T.kasse.erlassen}</th><th class="z">{T.kasse.offen}</th></tr></thead>
          <tbody>
            {#each kassenZeilen as x (x.spieler)}
              {@const g = x.buchungen.filter((b) => !b.storniert)}
              <tr>
                <td>{x.name}{x.verein ? ` (${x.verein})` : ''}</td>
                <td class="m">{x.da ? '✓' : '☐'}</td>
                <td class="z">{euro(x.soll)}</td>
                <td class="z">{euro(g.filter((b) => b.art === 'bar').reduce((s, b) => s + b.betrag, 0))}</td>
                <td class="z">{euro(g.filter((b) => b.art === 'ueberweisung').reduce((s, b) => s + b.betrag, 0))}</td>
                <td class="z">{euro(x.erlassen)}</td>
                <td class="z">{x.offen > 0 ? euro(x.offen) : ''}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr><th>{T.druck.summe}</th><th class="m">{summe.da}/{summe.gemeldet}</th><th class="z">{euro(summe.soll)}</th><th class="z">{euro(summe.bar)}</th><th class="z">{euro(summe.ueberweisung)}</th><th class="z">{euro(summe.erlassen)}</th><th class="z">{euro(summe.offen)}</th></tr>
          </tfoot>
        </table>
      </section>
    {:else if kassenArt === 'praemien'}
      {#if !auszahlungen.length}<p class="leer">{T.praemie.keineBelege}</p>{/if}
      <div class="quittungen">
        {#each auszahlungen as a (a.id)}
          {@const k = z.konkurrenzen[a.konkurrenz]}
          <article class="quittung" class:storniert={a.storniert} data-testid="praemie-beleg">
            {#if a.storniert}<div class="storno">{T.quittung.storniert}</div>{/if}
            <header>
              <div><strong>{z.kasse?.aussteller || z.name}</strong>{#if z.kasse?.anschrift}<div class="klein vor">{z.kasse.anschrift}</div>{/if}</div>
              <div class="rechts"><div class="q-titel">{T.praemie.beleg}</div><div>{T.quittung.nr} {quittungsNr(a).replace(/^Q/, 'P')}</div></div>
            </header>
            <dl>
              <dt>{T.quittung.betrag}</dt><dd class="betrag">{euro(a.betrag)}</dd>
              <dt>{T.praemie.an}</dt><dd>{k ? nameLang(z, a.teilnehmer, k) : a.teilnehmer}</dd>
              <dt>{T.quittung.fuer}</dt><dd>{T.praemie.fuer(platzText(a.platz), k?.einst.name ?? '', z.name)}</dd>
              <dt>{T.quittung.datum}</dt><dd>{zeitpunkt(a.zeit)}</dd>
            </dl>
            <div class="unterschrift"><span class="linie">{T.praemie.unterschriftEmpfang}</span><span class="linie">{T.praemie.unterschriftKasse}{a.von ? ` (${a.von})` : ''}</span></div>
          </article>
        {/each}
      </div>
    {:else if kassenArt === 'quittungen' && (!z.kasse?.aussteller.trim() || !z.kasse?.anschrift.trim())}
      <!-- Frage 15A: Aussteller und Anschrift sind auf Quittungen Pflicht -->
      <p class="leer" data-testid="quittung-pflicht">{T.quittung.pflichtFehlt}</p>
    {:else if kassenArt === 'quittungen'}
      {#if !quittungen.length}<p class="leer">{T.quittung.keine}</p>{/if}
      <div class="quittungen">
        {#each quittungen as b (b.id)}
          {@const sp = z.spieler[b.spieler]}
          <article class="quittung" class:storniert={!!b.storniert} data-testid="quittung">
            {#if b.storniert}<div class="storno">{T.quittung.storniert}</div>{/if}
            <header>
              <div><strong>{z.kasse?.aussteller || z.name}</strong>{#if z.kasse?.anschrift}<div class="klein vor">{z.kasse.anschrift}</div>{/if}</div>
              <div class="rechts"><div class="q-titel">{T.quittung.titel}</div><div>{T.quittung.nr} {quittungsNr(b)}</div><div class="klein">{T.quittung.ausgestellt(new Date().toLocaleDateString('de-DE'))}</div></div>
            </header>
            <dl>
              <dt>{T.quittung.betrag}</dt><dd class="betrag">{euro(b.betrag)}</dd>
              <dt>{T.quittung.von}</dt><dd>{sp ? `${sp.vorname} ${sp.nachname}`.trim() : '?'}{sp?.verein ? `, ${sp.verein}` : ''}</dd>
              <dt>{T.quittung.fuer}</dt><dd>{T.quittung.startgeld(z.name)}{postenVon(z, b.spieler).length ? ` (${postenVon(z, b.spieler).map((p) => p.name).join(', ')})` : ''}</dd>
              <dt>{T.quittung.zahlart}</dt><dd>{T.kasse.arten[b.art]}</dd>
              <dt>{T.quittung.datum}</dt><dd>{zeitpunkt(b.zeit)}</dd>
            </dl>
            {#if z.kasse?.ust === 'befreit'}<p class="klein">{T.quittung.befreit}</p>{/if}
            {#if z.kasse?.ust === 'enthalten'}<p class="klein">{T.quittung.enthalten(z.kasse.ustSatz, euro(enthalteneUst(b.betrag, z.kasse.ustSatz)))}</p>{/if}
            {#if z.kasse?.fusstext}<p class="klein">{z.kasse.fusstext}</p>{/if}
            <div class="unterschrift"><span>{[z.ort, new Date(b.zeit).toLocaleDateString('de-DE')].filter(Boolean).join(', ')}</span><span class="linie">{T.quittung.unterschrift}{b.von ? ` (${b.von})` : ''}</span></div>
          </article>
        {/each}
      </div>
    {:else if aktiv === 'spielzettel'}
      {#if !zettel.length}
        <p class="leer">{T.druck.keineZettel}</p>
      {:else}
        <div class="zettel-raster">
          {#each zettel as s (s.konkurrenz + s.id)}
            {@const k = z.konkurrenzen[s.konkurrenz]!}
            {@const vg = vorgabeVon(z, k, s)}
            {@const saetze = k.einst.eingabe === 'saetze' ? 0 : einstFuer(k, s).bestOf}
            <article class="zettel" data-spiel={lokal ? null : spielLink(s)}>
              <header>
                <div>
                  <div class="klein">{z.name}</div>
                  <div class="fett">{k.einst.name} · {rundeVon(k, s)}</div>
                </div>
                <div class="tischfeld">{T.druck.tisch}<strong>{s.tisch ?? ''}</strong></div>
              </header>
              <table class="saetze">
                <thead>
                  <tr>
                    <th class="sp">{T.druck.spieler}</th>
                    {#each Array.from({ length: saetze }) as _, i (i)}<th>{i + 1}</th>{/each}
                    <th class="st">{T.druck.saetze}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each ['a', 'b'] as const as seite (seite)}
                    {@const tid = seite === 'a' ? s.a : s.b}
                    <tr>
                      <td class="sp"><strong>{nameLang(z, tid, k)}</strong><span class="klein">{verein(k, tid)}{vg && vg.seite === seite ? ` · ${T.druck.vorgabe(vg.punkte)}` : ''}</span></td>
                      {#each Array.from({ length: saetze }) as _, i (i)}<td></td>{/each}
                      <td></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <footer>
                <div class="unterschriften">
                  <span>{T.druck.unterschriftSieger}</span>
                  <span>{T.druck.unterschriftSchiri}{s.schiri ? `: ${s.schiri.name}` : ''}</span>
                </div>
                {#if !lokal}
                  <div class="qr-klein">
                    <QrCode text={spielLink(s)} groesse={76} label={T.druck.qrErgebnis} />
                    <span class="klein">{T.druck.qrErgebnis}</span>
                  </div>
                {/if}
              </footer>
            </article>
          {/each}
        </div>
      {/if}
    {:else if aktiv === 'gruppen'}
      {#each gestartet.filter((k) => k.gruppen.length && !istRundenModus(k.einst.modus)) as k (k.id)}
        {#if !zeige(k).tabellen}
          <p class="leer">{k.einst.name}: {T.tab.verdeckt}</p>
        {:else}
          {#each k.gruppen as g (g.nr)}
            {@const t = tabelle(k, g.nr)}
            {@const m = t.zeilen.map((r) => r.id)}
            <section class="block gruppe">
              <h2>{z.name} · {k.einst.name}{k.gruppen.length > 1 ? ` · ${gruppeTitel(k, g.nr)}` : ''}</h2>
              <table class="kreuz">
                <thead>
                  <tr>
                    <th>{T.tab.platz}</th>
                    <th class="sp">{T.tab.spieler}</th>
                    {#each m as _, j (j)}<th class="feld">{j + 1}</th>{/each}
                    <th>{T.tab.sn}</th>
                    <th>{T.tab.saetze}</th>
                    {#if k.einst.eingabe === 'punkte'}<th>{T.tab.baelle}</th>{/if}
                  </tr>
                </thead>
                <tbody>
                  {#each t.zeilen as r, i (r.id)}
                    <tr class:raus={r.zurueckgezogen}>
                      <td class="z">{r.platz}{r.losNoetig && t.fertig ? '*' : ''}</td>
                      <td class="sp"><span class="nr">{i + 1}</span> <strong>{name(z, r.id, k)}</strong><span class="klein">{verein(k, r.id)}{r.zurueckgezogen ? ` · ${T.tab.zurueckgezogen}` : ''}</span></td>
                      {#each m as b, j (b)}<td class="feld" class:diag={i === j}>{i === j ? '' : kreuz(k, g.nr, r.id, b)}</td>{/each}
                      <td class="z">{r.siege}:{r.niederlagen}</td>
                      <td class="z">{r.saetzeG}:{r.saetzeV}</td>
                      {#if k.einst.eingabe === 'punkte'}<td class="z">{r.baelleG}:{r.baelleV}</td>{/if}
                    </tr>
                  {/each}
                </tbody>
              </table>
              <ol class="spielfolge">
                {#each k.reihenfolge.map((sid) => k.spiele[sid]!).filter((s) => s.phase === 'gruppen' && s.gruppe === g.nr && s.status !== 'entfallen') as s (s.id)}
                  <li><span>{T.druck.rundeKurz(s.runde)}</span> {name(z, s.a, k)} – {name(z, s.b, k)} <strong>{s.ergebnis ? ergebnisText(s.ergebnis) : ''}</strong>{s.gestrichen ? ` (${T.druck.gestrichen})` : ''}</li>
                {/each}
              </ol>
            </section>
          {/each}
        {/if}
      {:else}
        <p class="leer">{T.druck.keineGruppen}</p>
      {/each}
    {:else if aktiv === 'baum'}
      {#each gestartet.filter((k) => k.gestartet.ko && mitKo(k.einst.modus)) as k (k.id)}
        {#if !zeige(k).ko}
          <p class="leer">{k.einst.name}: {T.tab.verdecktKo}</p>
        {:else}
          {#each baeume(k) as b (b)}
            {#each baumTeile(k, b) as teil, ti (ti)}
              <section class="seite quer baum-seite">
                <h2>{z.name} · {k.einst.name} · {b === 'haupt' ? (k.einst.modus === 'gruppen_ko' ? T.konk.endrunde : T.konk.modi.ko) : T.konk.baeume[b]}{teil.titel ? ` · ${teil.titel}` : ''}</h2>
                <div class="baum" style:--n={Math.max(1, teil.spalten[0]?.spiele.length ?? 1)}>
                  {#each teil.spalten as sp, i (i)}
                    <div class="runde">
                      <h3>{sp.titel}</h3>
                      <div class="spiele">
                        {#each sp.spiele as s (s.id)}
                          <div class="box">
                            {#each ['a', 'b'] as const as seite (seite)}
                              {@const frei = seite === 'a' ? s.aFrei : s.bFrei}
                              {@const tid = seite === 'a' ? s.a : s.b}
                              <span class="zeile" class:sieger={s.gewinner === seite}><span class="n">{frei ? T.konk.freilos : tid ? name(z, tid, k) : ''}</span><span class="s">{satz(s, seite)}</span></span>
                            {/each}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if b === 'haupt' && k.spiele['ko-p3'] && ti === baumTeile(k, b).length - 1}
                  {@const p3 = k.spiele['ko-p3']!}
                  <p class="p3"><strong>{T.konk.platz3}:</strong> {name(z, p3.a, k)} – {name(z, p3.b, k)} {p3.ergebnis ? ergebnisText(p3.ergebnis) : ''}</p>
                {/if}
              </section>
            {/each}
          {/each}
        {/if}
      {:else}
        <p class="leer">{T.druck.keinBaum}</p>
      {/each}
    {:else if aktiv === 'ergebnisse'}
      <section class="block">
        <h1>{z.name}</h1>
        <p class="klein">{[datum(z.datum), z.ort].filter(Boolean).join(' · ')}</p>
      </section>
      {#each konkurrenzen as k (k.id)}
        {@const v = zeige(k)}
        {@const es = v.tabellen ? endstand(k) : []}
        <section class="block">
          <h2>{k.einst.name} <span class="klein">({T.druck.teilnehmerZahl(k.meldungen.length)})</span></h2>
          {#if !k.gestartet.gruppen && !k.gestartet.ko}
            <p class="klein">{T.tab.nichtGestartet}</p>
          {:else}
            {#if es.length}
              <h3>{T.druck.endstand}</h3>
              <ol class="endstand">
                {#each es as p (p.id)}<li><span class="pl">{p.bezeichnung}.</span> <strong>{nameLang(z, p.id, k)}</strong> <span class="klein">{verein(k, p.id)}</span></li>{/each}
              </ol>
            {/if}
            {#if v.tabellen && istRundenModus(k.einst.modus)}
              <h3>{istSchweizerArt(k.einst.modus) ? T.tab.rangliste : T.tab.rangleiter} · {T.tab.rundeStand(letzteRunde(k), letzteRunde(k))}</h3>
              <table class="liste">
                <tbody>
                  {#if istSchweizerArt(k.einst.modus)}
                    {#each schweizerTabelle(k, zurueckgezogen(k)) as r (r.id)}<tr><td class="z">{r.platz}</td><td>{name(z, r.id, k)}</td><td class="z">{punkteText(r.punkte)} {T.tab.punkte}</td><td class="z">{T.tab.buchholz} {punkteText(r.buchholz)}</td></tr>{/each}
                  {:else}
                    {#each kaiserTabelle(k, zurueckgezogen(k)).zeilen as r (r.id)}<tr><td class="z">{r.platz}</td><td>{name(z, r.id, k)}</td><td class="z">{r.siege}:{r.niederlagen}</td></tr>{/each}
                  {/if}
                </tbody>
              </table>
            {:else if v.tabellen}
              {#each k.gruppen as g (g.nr)}
                {@const t = tabelle(k, g.nr)}
                <h3>{k.gruppen.length > 1 ? gruppeTitel(k, g.nr) : T.konk.modi.jgj}</h3>
                <table class="liste">
                  <tbody>
                    {#each t.zeilen as r (r.id)}<tr class:raus={r.zurueckgezogen}><td class="z">{r.platz}</td><td>{name(z, r.id, k)} <span class="klein">{verein(k, r.id)}</span></td><td class="z">{r.siege}:{r.niederlagen}</td><td class="z">{r.saetzeG}:{r.saetzeV}</td></tr>{/each}
                  </tbody>
                </table>
              {/each}
            {/if}
            {#if v.ko || !mitKo(k.einst.modus)}
              <h3>{T.druck.alleSpiele}</h3>
              <ul class="spiele-liste">
                {#each k.reihenfolge.map((sid) => k.spiele[sid]!).filter((s) => s.ergebnis && s.status === 'gespielt') as s (s.id)}
                  <li><span class="klein">{rundeVon(k, s)}</span> {name(z, s.a, k)} – {name(z, s.b, k)} <strong>{ergebnisText(s.ergebnis!)}</strong></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </section>
      {/each}
    {:else if aktiv === 'teilnehmer'}
      <section class="block">
        <h2>{z.name} · {T.druck.arten.teilnehmer} ({teilnehmer.length})</h2>
        <table class="liste teilnehmer">
          <thead>
            <tr>
              <th>#</th>
              <th>{T.druck.name}</th>
              <th>{T.druck.verein}</th>
              {#if z.angaben.includes('ttr')}<th>TTR</th>{/if}
              {#if z.angaben.includes('klasse')}<th>{T.tspieler.klasse}</th>{/if}
              <th>{T.konk.titel}</th>
              <th>{T.druck.anwesend}</th>
            </tr>
          </thead>
          <tbody>
            {#each teilnehmer as s, i (s.id)}
              <tr>
                <td class="z">{i + 1}</td>
                <td><strong>{s.nachname}</strong>, {s.vorname}</td>
                <td>{s.verein}</td>
                {#if z.angaben.includes('ttr')}<td class="z">{s.ttr ?? ''}</td>{/if}
                {#if z.angaben.includes('klasse')}<td>{s.klasse ?? ''}</td>{/if}
                <td class="klein">{konkVon(s.id)}</td>
                <td class="kasten"><span></span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {:else if aktiv === 'aushang'}
      <section class="aushang">
        <h1>{z.name}</h1>
        <p class="unter">{[datum(z.datum), z.ort].filter(Boolean).join(' · ')}</p>
        {#if lokal}
          <p class="leer">{T.druck.aushangLokal}</p>
        {:else}
          <div class="qr-gross"><QrCode text={`${appBasis()}#/t/${id}`} groesse={320} label={T.druck.aushangQr} /></div>
          <p class="gross">{T.druck.aushangQr}</p>
          <p>{T.druck.aushangKennung} <strong class="kennung">{codeAnzeige(id)}</strong></p>
          <ol class="schritte">
            <li>{T.druck.aushangSchritt1}</li>
            <li>{T.druck.aushangSchritt2}</li>
            <li>{T.druck.aushangSchritt3}</li>
          </ol>
          <p class="klein">{appBasis()}</p>
        {/if}
      </section>
    {:else if aktiv === 'urkunden'}
      {#if !urkunden.length}
        <p class="leer">{T.druck.keineUrkunden}</p>
      {/if}
      {#each urkunden as u, i (u.k.id + u.id + u.zusatz + i)}
        <section class="urkunde">
          <div class="rahmen">
            {#if e.logo}<img class="logo" src={e.logo} alt="" />{/if}
            <h1>{T.druck.urkunde}</h1>
            <p class="anlass">{z.name}</p>
            <p class="name">{nameLang(z, u.id, u.k)}</p>
            {#if verein(u.k, u.id)}<p class="verein">{verein(u.k, u.id)}</p>{/if}
            <p class="text">{T.druck.urkundeText(u.k.einst.name + (u.zusatz ? ` (${u.zusatz})` : ''))}</p>
            <p class="platz">{u.platz}</p>
            <div class="fuss">
              <span>{[z.ort, datum(z.datum)].filter(Boolean).join(', ')}</span>
              <span class="linie">{e.unterschrift || T.druck.turnierleitung}</span>
            </div>
          </div>
        </section>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .mitte { text-align: center; margin: 20vh auto; }
  .werkzeug { position: sticky; top: 0; z-index: 5; background: var(--flaeche); border-bottom: 1px solid var(--linie); padding: 10px 16px; box-shadow: var(--schatten); }
  .werkzeug .reihe { max-width: 60rem; margin: 0 auto; }
  .werkzeug strong.wachsen { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .optionen { max-width: 60rem; margin: 6px auto 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 0 12px; }
  .optionen .voll { grid-column: 1 / -1; }
  .optionen label { margin: 8px 0 4px; }
  .tipp { max-width: 60rem; margin: 8px auto 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  input[type='file'] { min-height: 44px; padding: 8px; }

  /* Vorschau: weiße Blätter */
  .dokument { --s: #000; --l: #777; background: #fff; color: #000; max-width: 210mm; margin: 16px auto 40px; padding: 10mm; font-size: 10.5pt; line-height: 1.3; box-shadow: 0 2px 12px rgb(0 0 0 / 15%); }
  .dokument[data-art='baum'] { max-width: 297mm; }
  .dokument h1 { font-size: 18pt; margin: 0 0 4px; }
  .dokument h2 { font-size: 13pt; margin: 0 0 6px; }
  .dokument h3 { font-size: 11pt; margin: 8px 0 4px; }
  .klein { font-size: 8.5pt; color: #333; display: block; }
  .fett { font-weight: 700; }
  .leer { color: #555; font-style: italic; }
  .block { break-inside: avoid; margin-bottom: 8mm; }
  .z { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #555; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 9pt; }
  tr.raus { color: #777; }

  .zettel-raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .zettel { border: 1px dashed #888; padding: 4mm; break-inside: avoid; min-height: 128mm; display: flex; flex-direction: column; gap: 3mm; }
  .zettel header { display: flex; justify-content: space-between; gap: 3mm; }
  .tischfeld { border: 2px solid #000; min-width: 18mm; text-align: center; font-size: 8pt; padding: 1mm; display: flex; flex-direction: column; }
  .tischfeld strong { font-size: 18pt; line-height: 1.1; min-height: 8mm; }
  .saetze th, .saetze td { text-align: center; height: 11mm; }
  .saetze .sp { text-align: left; width: 45%; }
  .saetze .st { background: #ddd; }
  .zettel footer { margin-top: auto; display: flex; gap: 3mm; align-items: flex-end; }
  .unterschriften { flex: 1; display: flex; flex-direction: column; gap: 6mm; font-size: 8pt; }
  .unterschriften span { border-top: 1px solid #000; padding-top: 1mm; }
  .qr-klein { display: flex; flex-direction: column; align-items: center; width: 24mm; text-align: center; }
  .qr-klein .klein { font-size: 6.5pt; }

  .kreuz .feld { width: 11mm; text-align: center; font-variant-numeric: tabular-nums; }
  .kreuz .diag { background: #bbb; }
  .kreuz .sp { min-width: 40mm; }
  .kreuz .nr { display: inline-block; min-width: 5mm; color: #555; }
  .spielfolge { columns: 2; font-size: 9pt; margin: 3mm 0 0; padding-left: 5mm; }
  .spielfolge li span { color: #555; }

  .seite.quer { break-after: page; }
  .bericht { break-after: page; }
  .bericht:last-child { break-after: auto; }
  .bericht .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .bericht h2 { font-size: 1.05rem; margin: 8px 0 4px; }
  .bericht table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .bericht td, .bericht th { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  .bericht .z { text-align: center; }
  .bericht .pos { width: 3rem; font-weight: 700; }
  .bericht .teiltab { margin-top: 12px; }
  .bericht .summe td { font-weight: 700; }
  .unterschriften { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 40px; }
  .unterschriften div { border-top: 1px solid #333; padding-top: 4px; font-size: 0.85rem; }
  .seite.quer:last-child { break-after: auto; }
  .baum { display: flex; gap: 3mm; height: 170mm; }
  .runde { flex: 1 1 0; display: flex; flex-direction: column; min-width: 0; max-width: 75mm; }
  .runde h3 { font-size: 8.5pt; margin: 0 0 1mm; color: #333; }
  .spiele { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 1mm; }
  .box { border: 1px solid #000; font-size: clamp(5.5pt, calc(140pt / var(--n)), 10pt); }
  .zeile { display: flex; justify-content: space-between; gap: 2mm; padding: 0.3mm 1.5mm; }
  .zeile + .zeile { border-top: 1px solid #999; }
  .zeile.sieger { font-weight: 700; }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p3 { margin-top: 3mm; }

  .endstand { list-style: none; padding: 0; margin: 0; }
  .endstand .pl { display: inline-block; min-width: 14mm; font-weight: 700; }
  .endstand .klein { display: inline; }
  .liste td { border: 0; border-bottom: 1px solid #ccc; padding: 1mm 2mm; }
  .liste th { border: 0; border-bottom: 1.5px solid #000; background: none; }
  .spiele-liste { columns: 2; font-size: 9pt; padding-left: 0; list-style: none; margin: 0; }
  .spiele-liste .klein { display: inline; }
  .teilnehmer .kasten span { display: inline-block; width: 5mm; height: 5mm; border: 1px solid #000; }
  .teilnehmer td.klein { display: table-cell; }

  .aushang { text-align: center; padding: 10mm 0; }
  .aushang h1 { font-size: 30pt; }
  .aushang .unter { font-size: 14pt; }
  .qr-gross { display: flex; justify-content: center; margin: 10mm 0 4mm; }
  .aushang .gross { font-size: 20pt; font-weight: 700; }
  .kennung { font-family: ui-monospace, monospace; font-size: 18pt; letter-spacing: 0.1em; }
  .schritte { text-align: left; display: inline-block; font-size: 12pt; margin: 6mm auto; }

  .urkunde { break-after: page; height: 270mm; display: flex; }
  .urkunde:last-child { break-after: auto; }
  .rahmen { flex: 1; border: 3mm double #1f3f6e; padding: 18mm 14mm; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4mm; }
  .logo { max-height: 32mm; max-width: 70mm; object-fit: contain; }
  .urkunde h1 { font-size: 40pt; letter-spacing: 0.12em; color: #1f3f6e; margin-top: 6mm; font-family: Georgia, 'Times New Roman', serif; }
  .anlass { font-size: 16pt; }
  .urkunde .name { font-size: 28pt; font-weight: 700; margin-top: 12mm; font-family: Georgia, 'Times New Roman', serif; }
  .urkunde .verein { font-size: 14pt; color: #333; }
  .urkunde .text { font-size: 14pt; margin-top: 8mm; }
  .urkunde .platz { font-size: 34pt; font-weight: 800; color: #1f3f6e; }
  .urkunde .fuss { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; font-size: 11pt; }
  .urkunde .linie { border-top: 1px solid #000; min-width: 60mm; padding-top: 1mm; }

  .kassentab .z { text-align: right; white-space: nowrap; }
  .kassentab .m { text-align: center; }
  .kassentab tfoot th { border-top: 2px solid #000; }
  .quittungen { display: grid; grid-template-columns: 1fr; gap: 8mm; }
  .quittung { position: relative; border: 1px solid #000; padding: 6mm; break-inside: avoid; min-height: 120mm; display: flex; flex-direction: column; gap: 3mm; }
  .quittung header { display: flex; justify-content: space-between; gap: 6mm; }
  .quittung .rechts { text-align: right; }
  .quittung .q-titel { font-size: 18pt; font-weight: 800; letter-spacing: 0.06em; }
  .quittung .vor { white-space: pre-line; }
  .quittung dl { display: grid; grid-template-columns: max-content 1fr; gap: 2mm 6mm; margin: 2mm 0; }
  .quittung dt { font-weight: 700; }
  .quittung dd { margin: 0; overflow-wrap: anywhere; }
  .quittung .betrag { font-size: 16pt; font-weight: 800; }
  .quittung .unterschrift { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; font-size: 10pt; }
  .quittung .linie { border-top: 1px solid #000; min-width: 60mm; padding-top: 1mm; }
  .quittung .storno { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 40pt; font-weight: 900; color: rgb(192 57 43 / 45%); transform: rotate(-18deg); pointer-events: none; }

  @media (max-width: 640px) {
    .dokument { padding: 4mm; margin: 8px; font-size: 9pt; overflow-x: auto; }
    .zettel-raster { grid-template-columns: 1fr; }
    .spielfolge, .spiele-liste { columns: 1; }
  }

  @page { size: A4; margin: 10mm; }
  @page quer { size: A4 landscape; margin: 8mm; }
  @media print {
    :global(html), :global(body) { background: #fff !important; }
    .werkzeug { display: none; }
    .dokument { box-shadow: none; margin: 0; padding: 0; max-width: none; }
    .seite.quer { page: quer; }
    .zettel { min-height: 133mm; }
    .urkunde { height: 276mm; }
  }
</style>
