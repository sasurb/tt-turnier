<script lang="ts">
  import { onMount } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api, speicher } from '../dienste';
  import { app, anmeldungAbgelaufen, fehlerText } from '../app.svelte';
  import { lokaleTurnierId } from '../engine/ids';
  import { TurnierSitzung } from '../engine/turnier';
  import { anzeigeName, geraetId, setzeAnzeigeName, turnierMerken } from '../einstellungen';
  import Hilfe from './Hilfe.svelte';
  import { amGeraetDerZentrale, istZentrale } from '../zentrale.svelte';

  let name = $state('');
  let datum = $state(new Date().toISOString().slice(0, 10));
  let leiter = $state(anzeigeName());
  let fehler = $state('');
  let laeuft = $state(false);

  const onlineMoeglich = $derived(app.server.art === 'bereit' && !!app.sitzung);
  /** „Nur dieses Gerät“ gibt es nur in der Demo ohne Server und am Gerät der Zentrale */
  const lokalMoeglich = $derived(app.server.art === 'keiner' || amGeraetDerZentrale());
  const zentrale = $derived(istZentrale());
  let wahl = $state<'online' | 'lokal' | null>(null);
  const modus = $derived(wahl ?? (onlineMoeglich ? 'online' : 'lokal'));

  onMount(() => {
    // Turniere legt nur die angemeldete Turnierleitung an (bzw. die Demo ohne Server)
    if (app.server.art === 'bereit' && !app.sitzung && !amGeraetDerZentrale()) gehe('anmelden');
  });

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    if (name.trim().length < 2) {
      fehler = T.neu.nameZuKurz;
      return;
    }
    laeuft = true;
    try {
      if (modus === 'online' && app.sitzung) {
        const a = await api.turnierAnlegen(app.sitzung.token, { name: name.trim(), datum: datum || null });
        // Rechte kommen vom Konto; das Konto-Token wird nicht am Turnier gespeichert
        turnierMerken({ id: a.turnier.id, name: a.turnier.name, datum: a.turnier.datum, modus: 'online', rolle: 'zuschauer', token: null, konto: true });
        gehe('t/' + a.turnier.id);
      } else {
        const id = lokaleTurnierId();
        setzeAnzeigeName(leiter);
        const sitzung = new TurnierSitzung({
          speicher,
          turnier: id,
          modus: 'lokal',
          geraet: geraetId(),
          autor: { rolle: 'leitung', name: leiter.trim() || 'Leitung' },
        });
        await sitzung.eintragen(ART.turnierAngelegt, { name: name.trim(), datum: datum || null });
        turnierMerken({ id, name: name.trim(), datum: datum || null, modus: 'lokal', rolle: 'leitung', token: null });
        gehe('t/' + id);
      }
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.neu.titel}</h1>

<form class="karte" onsubmit={anlegen} novalidate>
  <label for="n">{T.neu.name}</label>
  <input id="n" bind:value={name} placeholder={T.neu.namePlatzhalter} autocomplete="off" required />
  <label for="d">{T.neu.datum}</label>
  <input id="d" type="date" bind:value={datum} />

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
  <div class="reihe" style="margin-top:16px">
    <button type="submit" disabled={laeuft}>{T.neu.anlegen}</button>
    <a class="knopf zweit" href={linkZu('')}>{T.app.abbrechen}</a>
  </div>
</form>

<p><a href={linkZu('wiederherstellen')}>{T.neu.wiederherstellen}</a></p>

<style>
  .hinweis { margin-top: 4px; font-size: 0.92rem; }
</style>
