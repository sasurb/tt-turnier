<script lang="ts">
  import { ART, type Sicherung } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api, speicher } from '../dienste';
  import { anmeldungAbgelaufen, app, fehlerText } from '../app.svelte';
  import { lokaleTurnierId } from '../engine/ids';
  import { TurnierSitzung } from '../engine/turnier';
  import { anzeigeName, geraetId, turnierMerken } from '../einstellungen';
  import { sicherungLesen } from '../sicherung';

  // raw: die Daten gehen unverändert in IndexedDB (Proxys lassen sich dort nicht speichern)
  let sicherung = $state.raw<Sicherung | null>(null);
  let fehler = $state('');
  let laeuft = $state(false);
  const onlineMoeglich = $derived(app.server.art === 'bereit' && !!app.sitzung);
  let wahl = $state<'online' | 'lokal' | null>(null);
  const ziel = $derived(wahl ?? (onlineMoeglich ? 'online' : 'lokal'));

  async function dateiGewaehlt(e: Event) {
    fehler = '';
    sicherung = null;
    const datei = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!datei) return;
    try {
      sicherung = sicherungLesen(await datei.text());
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  async function wiederherstellen() {
    if (!sicherung) return;
    fehler = '';
    laeuft = true;
    try {
      const s = sicherung;
      const name = anzeigeName() || app.sitzung?.konto.name || 'Leitung';
      let id: string;
      let sitzung: TurnierSitzung;
      let einmalToken: string | null = null;
      if (ziel === 'online' && app.sitzung) {
        const a = await api.turnierAnlegen(app.sitzung.token, { name: s.turnier.name, datum: s.turnier.datum });
        einmalToken = a.token;
        id = a.turnier.id;
        turnierMerken({ id, name: a.turnier.name, datum: a.turnier.datum, modus: 'online', rolle: 'zuschauer', token: null, konto: true });
        sitzung = new TurnierSitzung({ speicher, turnier: id, modus: 'online', geraet: geraetId(), autor: { rolle: 'leitung', name }, api, token: () => a.token });
      } else {
        id = lokaleTurnierId();
        sitzung = new TurnierSitzung({ speicher, turnier: id, modus: 'lokal', geraet: geraetId(), autor: { rolle: 'leitung', name } });
        turnierMerken({ id, name: s.turnier.name, datum: s.turnier.datum, modus: 'lokal', rolle: 'leitung', token: null });
      }
      const n = await sitzung.importieren(s.ereignisse);
      await sitzung.eintragen(ART.turnierWiederhergestellt, { quelle: s.turnier.id, erstellt: s.erstellt, anzahl: n });
      if (einmalToken) void api.logout(einmalToken).catch(() => undefined); // Hilfs-Token des Hochladens beenden
      app.hinweis = T.turnier.wiederhergestellt(n);
      gehe('t/' + id);
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }

  function zeit(iso: string) {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<h1>{T.wiederherstellen.titel}</h1>
<p class="leise">{T.wiederherstellen.einleitung}</p>

<section class="karte">
  <label for="wd">{T.wiederherstellen.datei}</label>
  <input id="wd" type="file" accept=".json,application/json" onchange={dateiGewaehlt} />

  {#if sicherung}
    <dl>
      <dt>{T.neu.name}</dt><dd><strong>{sicherung.turnier.name}</strong></dd>
      <dt>{T.wiederherstellen.stand}</dt><dd>{zeit(sicherung.erstellt)}</dd>
      <dt>{T.wiederherstellen.eintraege}</dt><dd>{sicherung.ereignisse.length}</dd>
    </dl>

    <fieldset>
      <legend>{T.wiederherstellen.ziel}</legend>
      <label class="wahl" class:aktiv={ziel === 'online'} class:aus={!onlineMoeglich}>
        <input type="radio" name="ziel" checked={ziel === 'online'} disabled={!onlineMoeglich} onchange={() => (wahl = 'online')} />
        <span><strong>{T.wiederherstellen.zielOnline}</strong>
          {#if !onlineMoeglich}<span class="leise">{T.neu.onlineAnmelden}</span>{/if}</span>
      </label>
      <label class="wahl" class:aktiv={ziel === 'lokal'}>
        <input type="radio" name="ziel" checked={ziel === 'lokal'} onchange={() => (wahl = 'lokal')} />
        <span><strong>{T.wiederherstellen.zielLokal}</strong></span>
      </label>
    </fieldset>

    {#if ziel === 'online'}
      <p class="leise">{T.wiederherstellen.autorHinweis}</p>
    {/if}
  {/if}

  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe" style="margin-top:16px">
    <button disabled={!sicherung || laeuft} onclick={wiederherstellen}>{T.wiederherstellen.knopf}</button>
    <a class="knopf zweit" href={linkZu('neu')}>{T.app.abbrechen}</a>
  </div>
</section>

<style>
  input[type='file'] { padding: 10px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 16px 0; }
  dt { color: var(--leise); }
  dd { margin: 0; }
</style>
