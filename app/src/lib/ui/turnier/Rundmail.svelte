<script lang="ts">
  /**
   * Nachricht der Turnierleitung an Gruppen (ab 0.18). Die App bestimmt die Spieler-IDs (alle, je Konkurrenz,
   * eingecheckt / nicht eingecheckt, Mannschaftsführung); der Server stellt in den Posteingang der Kennungen zu
   * und mailt auf Wunsch an Online-Angemeldete bzw. deren Mannschaftsleitung.
   */
  import { NACHRICHT_MAX_TEXT, NACHRICHT_MAX_TITEL } from '@shared/protokoll';
  import { api } from '../../dienste';
  import { app, fehlerText } from '../../app.svelte';
  import { T } from '../../texte';
  import { spielerVon, type TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  let { z, turnierId, token, gesendet }: { z: TurnierZustand; turnierId: string; token: string; gesendet?: () => void } = $props();

  const zentrale = $derived(app.server.art === 'bereit' && !!app.server.info.zentrale);
  const mailMoeglich = $derived(app.server.art === 'bereit' && !!app.server.info.mail && !!app.server.info.anmeldung && !zentrale);

  let offen = $state(false);
  let alle = $state(false);
  let konkurrenzen = $state<string[]>([]);
  let eingecheckt = $state(false);
  let nichtEingecheckt = $state(false);
  let fuehrer = $state(false);
  let helfer = $state(false);
  let leitung = $state(false);
  let warteliste = $state(false);
  let mail = $state(true);
  let betreff = $state('');
  let text = $state('');
  let laeuft = $state(false);
  let meldung = $state<{ ok: boolean; text: string } | null>(null);

  /** Spieler, die in mindestens einer Konkurrenz gemeldet sind (ohne Zurückgezogene bleibt bei der Leitung) */
  function gemeldeteIn(kid: string): string[] {
    const k = z.konkurrenzen[kid];
    if (!k) return [];
    return k.meldungen.flatMap((t) => spielerVon(k, t));
  }
  const imTurnier = $derived(new Set(z.konkurrenzReihe.flatMap((kid) => gemeldeteIn(kid))));

  const empfaenger = $derived.by(() => {
    const ids = new Set<string>();
    if (alle) for (const sid of z.spielerReihe) ids.add(sid);
    for (const kid of konkurrenzen) for (const sid of gemeldeteIn(kid)) ids.add(sid);
    if (eingecheckt) for (const sid of z.spielerReihe) if (z.checkin[sid]) ids.add(sid);
    if (nichtEingecheckt) for (const sid of imTurnier) if (!z.checkin[sid]) ids.add(sid);
    if (fuehrer)
      for (const kid of z.konkurrenzReihe) {
        const k = z.konkurrenzen[kid]!;
        for (const m of Object.values(k.mannschaften ?? {})) if (m.fuehrer && k.meldungen.includes(m.id)) ids.add(m.fuehrer);
      }
    return [...ids].filter((sid) => !!z.spieler[sid]);
  });
  const mitMannschaft = $derived(z.konkurrenzReihe.some((kid) => z.konkurrenzen[kid]!.einst.art === 'mannschaft'));
  const gruppeText = $derived(
    [
      alle && T.rundmail.alle,
      ...konkurrenzen.map((kid) => z.konkurrenzen[kid]?.einst.name ?? kid),
      eingecheckt && T.rundmail.eingecheckt,
      nichtEingecheckt && T.rundmail.nichtEingecheckt,
      fuehrer && T.rundmail.fuehrer,
      helfer && T.rundmail.helfer,
      leitung && T.rundmail.leitung,
      warteliste && T.rundmail.warteliste,
    ]
      .filter(Boolean)
      .join(', '),
  );
  const nichtsGewaehlt = $derived(!empfaenger.length && !helfer && !leitung && !(warteliste && mail && mailMoeglich));

  async function senden() {
    meldung = null;
    if (nichtsGewaehlt) {
      meldung = { ok: false, text: T.rundmail.keine };
      return;
    }
    if (!confirm(T.rundmail.frage(empfaenger.length + (helfer ? 1 : 0)))) return;
    laeuft = true;
    try {
      const r = await api.rundmail(token, {
        turnier: turnierId,
        betreff: betreff.trim(),
        text: text.trim(),
        gruppe: gruppeText.slice(0, 120),
        spieler: empfaenger,
        helfer,
        leitung,
        warteliste: warteliste && mailMoeglich ? [...z.konkurrenzReihe] : [],
        mail: mail && mailMoeglich,
      });
      meldung = { ok: true, text: T.rundmail.gesendet(r.postfach, r.mails) };
      betreff = '';
      text = '';
      gesendet?.();
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    } finally {
      laeuft = false;
    }
  }
</script>

<details class="karte abschnitt" bind:open={offen} data-testid="abschnitt-rundmail">
  <summary><h2 class="titel">✉ {T.rundmail.titel}</h2></summary>
  <p class="leise">{T.rundmail.hilfe}</p>
  {#if zentrale}<p class="meldung info">{T.rundmail.zentrale}</p>{/if}
  <fieldset>
    <legend>{T.rundmail.an}</legend>
    <label class="haken"><input type="checkbox" bind:checked={alle} data-testid="rm-alle" /> {T.rundmail.alle} <span class="leise">({z.spielerReihe.length})</span></label>
    {#each z.konkurrenzReihe as kid (kid)}
      <label class="haken"><input type="checkbox" value={kid} bind:group={konkurrenzen} /> {z.konkurrenzen[kid]!.einst.name} <span class="leise">({gemeldeteIn(kid).length})</span></label>
    {/each}
    <label class="haken"><input type="checkbox" bind:checked={eingecheckt} /> {T.rundmail.eingecheckt}</label>
    <label class="haken"><input type="checkbox" bind:checked={nichtEingecheckt} /> {T.rundmail.nichtEingecheckt}</label>
    {#if mitMannschaft}<label class="haken"><input type="checkbox" bind:checked={fuehrer} /> {T.rundmail.fuehrer}</label>{/if}
    <label class="haken"><input type="checkbox" bind:checked={helfer} data-testid="rm-helfer" /> {T.rundmail.helfer}</label>
    <label class="haken"><input type="checkbox" bind:checked={leitung} /> {T.rundmail.leitung}</label>
    {#if mailMoeglich}
      <div class="mit-hilfe"><label class="haken"><input type="checkbox" bind:checked={warteliste} /> {T.rundmail.warteliste}</label><Hilfe text={T.rundmail.warteHilfe} /></div>
    {/if}
  </fieldset>
  <p class="leise" data-testid="rm-anzahl">{T.rundmail.anzahl(empfaenger.length)}</p>
  {#if mailMoeglich}
    <div class="mit-hilfe"><label class="haken"><input type="checkbox" bind:checked={mail} /> {T.rundmail.mail}</label><Hilfe text={T.rundmail.mailHilfe} /></div>
  {/if}
  <label for="rm-betreff">{T.rundmail.betreff}</label>
  <input id="rm-betreff" bind:value={betreff} maxlength={NACHRICHT_MAX_TITEL} autocomplete="off" />
  <label for="rm-text">{T.rundmail.text}</label>
  <textarea id="rm-text" bind:value={text} rows="5" maxlength={NACHRICHT_MAX_TEXT}></textarea>
  <p class="leise zaehler">{text.length} / {NACHRICHT_MAX_TEXT}</p>
  {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
  <button class="breit" onclick={senden} disabled={laeuft || betreff.trim().length < 2 || text.trim().length < 2} data-testid="rm-senden">{T.rundmail.senden}</button>
</details>

<style>
  .abschnitt > summary .titel { font-size: 1.2rem; margin: 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 0; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .mit-hilfe { display: flex; align-items: center; gap: 6px; }
  fieldset { margin-top: 8px; }
  .zaehler { text-align: right; margin-top: 4px; }
  textarea { resize: vertical; }
</style>
