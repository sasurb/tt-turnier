<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { speicher } from '../dienste';
  import { lokaleTurnierId } from '../engine/ids';
  import { TurnierSitzung } from '../engine/turnier';
  import { anzeigeName, geraetId, setzeAnzeigeName, turnierMerken } from '../einstellungen';

  let name = $state('');
  let datum = $state(new Date().toISOString().slice(0, 10));
  let leiter = $state(anzeigeName());
  let fehler = $state('');
  let laeuft = $state(false);

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    if (name.trim().length < 2) {
      fehler = T.neuLokal.name + ': mindestens 2 Zeichen.';
      return;
    }
    laeuft = true;
    try {
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
    } catch (x) {
      fehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.neuLokal.titel}</h1>
<p class="leise">{T.start.neuLokalHinweis}</p>

<form class="karte" onsubmit={anlegen}>
  <label for="n">{T.neuLokal.name}</label>
  <input id="n" bind:value={name} placeholder={T.neuLokal.namePlatzhalter} autocomplete="off" required />
  <label for="d">{T.neuLokal.datum}</label>
  <input id="d" type="date" bind:value={datum} />
  <label for="l">{T.neuLokal.leiter}</label>
  <input id="l" bind:value={leiter} autocomplete="name" />
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe" style="margin-top:16px">
    <button type="submit" disabled={laeuft}>{T.neuLokal.anlegen}</button>
    <a class="knopf zweit" href={linkZu('')}>{T.app.abbrechen}</a>
  </div>
</form>
