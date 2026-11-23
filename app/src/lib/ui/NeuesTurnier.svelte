<script lang="ts">
  /**
   * Neues Turnier mit Startassistent (ab 0.16): führt in 8 Schritten durch alles Wesentliche (Angaben, Betriebsart,
   * Konkurrenzarten, Spielsysteme, Leistungsklassen, Anmeldung/Kasse, Sichtbarkeit, Zugänge). „Turnier anlegen“ im
   * ersten Schritt legt sofort mit allen Arten und Spielsystemen an (alles später in den Einstellungen änderbar).
   */
  import { onMount } from 'svelte';
  import { ART, type KasseEinstellungen } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api, speicher } from '../dienste';
  import { app, anmeldungAbgelaufen, fehlerText } from '../app.svelte';
  import { lokaleTurnierId } from '../engine/ids';
  import { TurnierSitzung } from '../engine/turnier';
  import { anzeigeName, geraetId, setzeAnzeigeName, turnierMerken } from '../einstellungen';
  import Hilfe from './Hilfe.svelte';
  import TtrGrenzenWahl from './turnier/TtrGrenzenWahl.svelte';
  import { amGeraetDerZentrale, istZentrale } from '../zentrale.svelte';
  import { ALLE_ARTEN, MODI, MODI_MANNSCHAFT, STANDARD_ANGABEN, type Angabe, type KonkurrenzArt, type Modus } from '../engine/modell';
  import { STANDARD_AUSWAHL, auswahlOrdnen, auswahlPruefen } from '../engine/auswahl';

  let name = $state('');
  let datum = $state(new Date().toISOString().slice(0, 10));
  let leiter = $state(anzeigeName());
  let ort = $state('');
  let tische = $state('');
  let fehler = $state('');
  let laeuft = $state(false);

  const onlineMoeglich = $derived(app.server.art === 'bereit' && !!app.sitzung);
  /** „Nur dieses Gerät“ gibt es nur in der Demo ohne Server und am Gerät der Zentrale */
  const lokalMoeglich = $derived(app.server.art === 'keiner' || amGeraetDerZentrale());
  const zentrale = $derived(istZentrale());
  let wahl = $state<'online' | 'lokal' | null>(null);
  const modus = $derived(wahl ?? (onlineMoeglich ? 'online' : 'lokal'));

  /* Assistent */
  const SCHRITTE = T.assistent.schritte.length;
  let schritt = $state(0);
  let arten = $state<KonkurrenzArt[]>([...STANDARD_AUSWAHL.arten]);
  let modi = $state<Modus[]>([...STANDARD_AUSWAHL.modi]);
  let klassen = $state<'keine' | 'klasse' | 'ttr'>('keine');
  let grenzen = $state('1200, 1500');
  let anmeldung = $state(false);
  let kasse = $state(false);
  let tabellen = $state(true);
  let ko = $state(true);
  let namen = $state<'voll' | 'kurz'>('voll');
  let danach = $state<'teilnehmer' | 'konkurrenzen' | 'zugaenge'>('teilnehmer');
  const auswahlFehler = $derived(auswahlPruefen(auswahlOrdnen({ arten, modi })));
  const grenzenListe = $derived([...new Set(grenzen.split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0 && n <= 4000))].sort((a, b) => a - b));

  // Fehlerhinweis verschwindet, sobald der Name passt
  $effect(() => {
    if (fehler === T.neu.nameZuKurz && name.trim().length >= 2) fehler = '';
    // Auswahl wieder in Ordnung: Hinweis weg
    if (fehler && (schritt === 1 || schritt === 2) && !auswahlFehler) fehler = '';
  });

  onMount(() => {
    // Turniere legt nur die angemeldete Turnierleitung an (bzw. die Demo ohne Server)
    if (app.server.art === 'bereit' && !app.sitzung && !amGeraetDerZentrale()) gehe('anmelden');
  });

  function nameOk(): boolean {
    if (name.trim().length < 2) {
      fehler = T.neu.nameZuKurz;
      schritt = 0;
      return false;
    }
    return true;
  }

  function weiter() {
    fehler = '';
    if (schritt === 0 && !nameOk()) return;
    if ((schritt === 1 || schritt === 2) && auswahlFehler) {
      fehler = auswahlFehler;
      return;
    }
    schritt = Math.min(SCHRITTE - 1, schritt + 1);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }
  function zurueck() {
    fehler = '';
    schritt = Math.max(0, schritt - 1);
  }

  /** Turnierdaten aus dem Assistenten (null = schnell angelegt: alles angeboten, Standard-Angaben) */
  function turnierDaten(): Record<string, unknown> {
    const t = parseInt(tische, 10);
    const angaben: Angabe[] = [...STANDARD_ANGABEN];
    if (klassen === 'klasse' && !angaben.includes('klasse')) angaben.push('klasse');
    if (klassen === 'ttr' && !angaben.includes('ttr')) angaben.push('ttr');
    if (arten.includes('mixed') && !angaben.includes('geschlecht')) angaben.push('geschlecht');
    return {
      ort: ort.trim(),
      tische: Number.isFinite(t) && t > 0 && t <= 200 ? t : null,
      angaben,
      konkurrenzarten: auswahlOrdnen({ arten, modi }),
      klassenVorgabe: { nach: klassen, grenzen: klassen === 'ttr' ? grenzenListe : [] },
      veroeffentlichung: { tabellen, ko },
    };
  }

  async function kasseVorgabe(): Promise<KasseEinstellungen> {
    const leer: KasseEinstellungen = { aussteller: '', anschrift: '', ust: 'keiner', ustSatz: 19, fusstext: '', empfaenger: '', iban: '', bic: '' };
    if (modus === 'online' && app.sitzung && !istZentrale()) {
      try {
        const k = (await api.kontoEinstellungen(app.sitzung.token)).kasse;
        if (k) return { ...leer, ...k };
      } catch {
        /* ohne Vorgabe weiter */
      }
    }
    return { ...leer, aussteller: app.sitzung?.konto.name ?? leiter.trim() };
  }

  /**
   * Anlegen. `mitAssistent` = Einstellungen aus den Schritten übernehmen; sonst schnell mit allem (Konkurrenzarten
   * und Spielsysteme bleiben offen, später unter „Einstellungen“ einschränkbar).
   */
  async function anlegen(mitAssistent: boolean) {
    fehler = '';
    if (!nameOk()) return;
    if (mitAssistent && auswahlFehler) {
      fehler = auswahlFehler;
      return;
    }
    laeuft = true;
    try {
      let id: string;
      let sitzung: TurnierSitzung;
      if (modus === 'online' && app.sitzung) {
        const a = await api.turnierAnlegen(app.sitzung.token, { name: name.trim(), datum: datum || null });
        id = a.turnier.id;
        // Rechte kommen vom Konto; das Konto-Token wird nicht am Turnier gespeichert
        turnierMerken({ id, name: a.turnier.name, datum: a.turnier.datum, modus: 'online', rolle: 'zuschauer', token: null, konto: true });
        const token = app.sitzung.token;
        // Einträge landen im Gerätespeicher und gehen mit dem Abgleich der Turnieransicht an den Server
        sitzung = new TurnierSitzung({ speicher, turnier: id, modus: 'online', geraet: geraetId(), api, token: () => token, autor: { rolle: 'leitung', name: app.sitzung.konto.name } });
      } else {
        id = lokaleTurnierId();
        setzeAnzeigeName(leiter);
        sitzung = new TurnierSitzung({ speicher, turnier: id, modus: 'lokal', geraet: geraetId(), autor: { rolle: 'leitung', name: leiter.trim() || 'Leitung' } });
        await sitzung.eintragen(ART.turnierAngelegt, { name: name.trim(), datum: datum || null });
        turnierMerken({ id, name: name.trim(), datum: datum || null, modus: 'lokal', rolle: 'leitung', token: null });
      }
      if (mitAssistent) {
        const d = turnierDaten();
        if (kasse) d.kasse = await kasseVorgabe();
        await sitzung.eintragen(ART.turnierDaten, d);
        // „Namen für Zuschauer“ werten auch die Server aus – eigener Eintrag (lässt sich nicht rückgängig machen)
        if (namen === 'kurz') await sitzung.eintragen(ART.turnierDaten, { namen });
        if (anmeldung && modus === 'online') app.hinweis = T.assistent.anmeldungHilfe;
      } else {
        const t = parseInt(tische, 10);
        if (ort.trim() || (Number.isFinite(t) && t > 0)) await sitzung.eintragen(ART.turnierDaten, { ort: ort.trim(), tische: Number.isFinite(t) && t > 0 && t <= 200 ? t : null });
      }
      gehe(`t/${id}${mitAssistent ? `/${danach === 'zugaenge' && modus !== 'online' ? 'teilnehmer' : danach}` : ''}`);
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }

  const zfArten = $derived(arten.map((a) => T.konk.arten[a]).join(', ') || '–');
  const zfModi = $derived(MODI.filter((m) => modi.includes(m)).map((m) => T.konk.modi[m]).join(', ') || '–');
</script>

<h1>{schritt === 0 ? T.neu.titel : T.assistent.titel}</h1>

<div class="karte assistent" data-testid="assistent">
  <div class="kopf">
    <span class="leise" data-testid="assistent-schritt">{T.assistent.schritt(schritt + 1, SCHRITTE)} · <strong>{T.assistent.schritte[schritt]}</strong></span>
    <a class="leise" href={linkZu('hilfe/turnier')} target="_blank" rel="noopener">{T.assistent.hilfeLink}</a>
  </div>
  <div class="balken" aria-hidden="true"><span style="width:{((schritt + 1) / SCHRITTE) * 100}%"></span></div>

  {#if schritt === 0}
    <form onsubmit={(e) => { e.preventDefault(); weiter(); }} novalidate>
      <p class="leise">{T.assistent.angabenText}</p>
      <label for="n">{T.neu.name}</label>
      <input id="n" bind:value={name} placeholder={T.neu.namePlatzhalter} autocomplete="off" required />
      <label for="d">{T.neu.datum}</label>
      <input id="d" type="date" bind:value={datum} />
      <div class="raster">
        <div><label for="ort">{T.assistent.ort}</label><input id="ort" bind:value={ort} maxlength="120" /></div>
        <div>
          <div class="label-zeile"><label for="ti">{T.assistent.tische}</label><Hilfe text={T.assistent.tischeHilfe} /></div>
          <input id="ti" bind:value={tische} inputmode="numeric" maxlength="3" />
        </div>
      </div>

      {#if lokalMoeglich && (onlineMoeglich || app.server.art !== 'keiner')}
        <fieldset>
          <legend>{T.neu.wo}</legend>
          <label class="wahl" class:aktiv={modus === 'online'} class:aus={!onlineMoeglich}>
            <input type="radio" name="modus" value="online" checked={modus === 'online'} disabled={!onlineMoeglich} onchange={() => (wahl = 'online')} />
            <span>
              <strong>{zentrale ? T.zentrale.neuTitel : T.neu.online}</strong>
              <span class="leise">{zentrale ? T.zentrale.neuText : T.neu.onlineText}</span>
              {#if app.server.art !== 'bereit'}
                <span class="leise hinweis">{T.neu.onlineKeinServer}</span>
              {:else if !app.sitzung}
                <span class="leise hinweis">{T.zentrale.nurZentraleGeraet}</span>
              {/if}
            </span>
          </label>
          <label class="wahl" class:aktiv={modus === 'lokal'}>
            <input type="radio" name="modus" value="lokal" checked={modus === 'lokal'} onchange={() => (wahl = 'lokal')} />
            <span>
              <strong>{T.neu.lokal}</strong>
              <span class="leise">{T.neu.lokalText}</span>
            </span>
          </label>
        </fieldset>
      {/if}

      {#if modus === 'online'}
        <p class="leise" id="k-info">{T.neu.kennungInfo}</p>
        {#if app.sitzung && app.sitzung.konto.email}<p class="leise">{T.neu.sicherungInfo(app.sitzung.konto.email)}</p>{/if}
      {:else}
        <div class="label-zeile"><label for="l">{T.neu.leiter}</label><Hilfe text={T.neu.leiterHilfe} /></div>
        <input id="l" bind:value={leiter} autocomplete="name" />
      {/if}

      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <div class="reihe knoepfe">
        <button type="submit" disabled={laeuft} data-testid="assistent-weiter">{T.neu.weiter}</button>
        <button type="button" class="zweit" disabled={laeuft} onclick={() => anlegen(false)}>{T.neu.anlegen}</button>
      </div>
      <p class="leise klein">{T.neu.schnell}</p>
    </form>
  {:else}
    {#if schritt === 1}
      <p>{T.assistent.artenText}<Hilfe text={T.assistent.artenHilfe} /></p>
      {#each ALLE_ARTEN as a (a)}
        <label class="wahl" class:aktiv={arten.includes(a)}>
          <input type="checkbox" value={a} bind:group={arten} data-testid="art-{a}" />
          <span><strong>{T.konk.arten[a]}</strong><span class="leise">{T.assistent.artenText2[a]}</span></span>
        </label>
      {/each}
    {:else if schritt === 2}
      <p>{T.assistent.modiText}<Hilfe text={T.assistent.modiHilfe} /></p>
      {#each MODI as m (m)}
        <label class="wahl" class:aktiv={modi.includes(m)}>
          <input type="checkbox" value={m} bind:group={modi} data-testid="modus-{m}" />
          <span>
            <strong>{T.konk.modi[m]}</strong>
            <span class="leise">{T.konk.modiText[m]}{#if arten.includes('mannschaft') && !MODI_MANNSCHAFT.includes(m)} ({T.assistent.modiNurEinzel}){/if}</span>
          </span>
        </label>
      {/each}
    {:else if schritt === 3}
      <p>{T.assistent.klassenText}<Hilfe text={T.assistent.klassenHilfe} /></p>
      {#each ['keine', 'klasse', 'ttr'] as const as w (w)}
        <label class="wahl" class:aktiv={klassen === w}>
          <input type="radio" name="klassen" value={w} bind:group={klassen} data-testid="klassen-{w}" />
          <span><strong>{T.assistent.klassenWahl[w]}</strong></span>
        </label>
      {/each}
      {#if klassen === 'ttr'}<TtrGrenzenWahl bind:wert={grenzen} id="assistent-start" />{/if}
    {:else if schritt === 4}
      <p>{T.assistent.anmeldungText}</p>
      <div class="haken-zeile">
        <label class="haken"><input type="checkbox" bind:checked={anmeldung} disabled={modus !== 'online' || zentrale} /> {T.assistent.anmeldung}</label>
        <Hilfe text={T.assistent.anmeldungHilfe} />
      </div>
      {#if modus !== 'online' || zentrale}<p class="leise">{T.assistent.anmeldungNurOnline}</p>{/if}
      <div class="haken-zeile">
        <label class="haken"><input type="checkbox" bind:checked={kasse} data-testid="assistent-kasse" /> {T.assistent.kasse}</label>
        <Hilfe text={T.assistent.kasseHilfe} />
      </div>
    {:else if schritt === 5}
      <p>{T.assistent.sichtText}<Hilfe text={T.assistent.sichtHilfe} /></p>
      <label class="haken"><input type="checkbox" bind:checked={tabellen} /> {T.assistent.tabellen}</label>
      <label class="haken"><input type="checkbox" bind:checked={ko} /> {T.assistent.ko}</label>
      <fieldset>
        <legend>{T.assistent.namen}<Hilfe text={T.einstellungen.namenHilfe} /></legend>
        {#each ['voll', 'kurz'] as const as n (n)}
          <label class="wahl" class:aktiv={namen === n}>
            <input type="radio" name="namen" value={n} bind:group={namen} />
            <span><strong>{T.einstellungen.namenWahl[n]}</strong><span class="leise">{T.einstellungen.namenWahlText[n]}</span></span>
          </label>
        {/each}
      </fieldset>
    {:else if schritt === 6}
      <p>{modus === 'online' ? T.assistent.zugaengeText : T.assistent.zugaengeLokal}</p>
      {#if modus === 'online'}
        <ul class="punkte">{#each T.assistent.zugaengePunkte as p (p)}<li>{p}</li>{/each}</ul>
      {/if}
      <fieldset>
        <legend>{T.assistent.danach}</legend>
        {#each ['teilnehmer', 'konkurrenzen', 'zugaenge'] as const as w (w)}
          {#if w !== 'zugaenge' || modus === 'online'}
            <label class="wahl" class:aktiv={danach === w}>
              <input type="radio" name="danach" value={w} bind:group={danach} />
              <span><strong>{T.assistent.danachWahl[w]}</strong></span>
            </label>
          {/if}
        {/each}
      </fieldset>
    {:else}
      <p class="leise">{T.assistent.zusammenfassung}</p>
      <dl class="zf" data-testid="zusammenfassung">
        <dt>{T.assistent.zf.name}</dt><dd>{name.trim()}{datum ? ` · ${new Date(datum).toLocaleDateString('de-DE')}` : ''}{ort.trim() ? ` · ${ort.trim()}` : ''}</dd>
        <dt>{T.assistent.zf.wo}</dt><dd>{modus === 'online' ? (zentrale ? T.zentrale.neuTitel : T.neu.online) : T.neu.lokal}</dd>
        <dt>{T.assistent.zf.arten}</dt><dd>{zfArten}</dd>
        <dt>{T.assistent.zf.modi}</dt><dd>{zfModi}</dd>
        <dt>{T.assistent.zf.klassen}</dt><dd>{T.assistent.klassenWahl[klassen]}{klassen === 'ttr' && grenzenListe.length ? ` (${grenzenListe.join(', ')})` : ''}</dd>
        <dt>{T.assistent.zf.anmeldung}</dt><dd>{anmeldung && modus === 'online' ? T.assistent.zf.ja : T.assistent.zf.nein}</dd>
        <dt>{T.assistent.zf.kasse}</dt><dd>{kasse ? T.assistent.zf.ja : T.assistent.zf.nein}</dd>
        <dt>{T.assistent.zf.sicht}</dt><dd>{tabellen && ko ? T.assistent.zf.offen : T.assistent.zf.verdeckt} · {T.einstellungen.namenWahl[namen]}</dd>
      </dl>
    {/if}

    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe knoepfe">
      <button type="button" class="zweit" onclick={zurueck}>{T.assistent.zurueck}</button>
      {#if schritt < SCHRITTE - 1}
        <button type="button" onclick={weiter} data-testid="assistent-weiter">{T.assistent.weiter}</button>
        <button type="button" class="zweit" disabled={laeuft || !!auswahlFehler} onclick={() => anlegen(true)}>{T.assistent.ueberspringen}</button>
      {:else}
        <button type="button" class="start" disabled={laeuft} onclick={() => anlegen(true)} data-testid="assistent-anlegen">{T.neu.anlegen}</button>
      {/if}
    </div>
  {/if}
</div>

{#if schritt === 0}
  <p><a href={linkZu('')}>{T.app.abbrechen}</a> · <a href={linkZu('wiederherstellen')}>{T.neu.wiederherstellen}</a></p>
{/if}

<style>
  .hinweis { margin-top: 4px; font-size: 0.92rem; }
  .kopf { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: baseline; }
  .kopf a { min-height: 44px; display: inline-flex; align-items: center; }
  .balken { height: 6px; background: var(--linie); border-radius: 3px; overflow: hidden; margin: 4px 0 12px; }
  .balken span { display: block; height: 100%; background: var(--blau); transition: width 0.2s; }
  .raster { display: grid; grid-template-columns: 2fr 1fr; gap: 0 12px; margin-top: 10px; }
  @media (max-width: 420px) {
    .raster { grid-template-columns: 1fr; }
  }
  .knoepfe { margin-top: 16px; }
  .klein { font-size: 0.9rem; margin: 6px 0 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; margin: 4px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken-zeile { display: flex; align-items: center; gap: 4px; }
  .wahl input[type='checkbox'] { width: 22px; height: 22px; min-height: 0; flex: none; }
  .punkte { padding-left: 1.2rem; }
  .punkte li { margin: 4px 0; }
  .zf { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
  .zf dt { font-weight: 700; }
  .zf dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 420px) {
    .zf { grid-template-columns: 1fr; gap: 0; }
    .zf dd { margin-bottom: 8px; }
  }
  .start { background: var(--gruen); }
  legend { display: flex; align-items: center; }
</style>
