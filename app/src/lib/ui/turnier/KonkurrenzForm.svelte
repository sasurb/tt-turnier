<script lang="ts">
  import TtrGrenzenWahl from './TtrGrenzenWahl.svelte';
  import { T } from '../../texte';
  import { SYSTEME, SYSTEM_REIHE, bisSiege, folgeLesen, folgeText, standardMannschaft, systemVon, type SystemId } from '../../engine/mannschaft';
  import { MODI, MODI_MANNSCHAFT, centAus, standardEinstellungen, type BestOf, type Geschlecht, type KonkurrenzEinstellungen } from '../../engine/modell';
  import { klassen as klassenStore } from '../../klassen.svelte';
  import Hilfe from '../Hilfe.svelte';
  import WertungInfo from './WertungInfo.svelte';

  let {
    start = standardEinstellungen(),
    gestartet = false,
    mitMeldungen = false,
    knopf,
    speichern,
    abbrechen,
  }: {
    start?: KonkurrenzEinstellungen;
    gestartet?: boolean;
    /** Einzel/Doppel lässt sich nur ohne Meldungen umstellen */
    mitMeldungen?: boolean;
    knopf: string;
    speichern: (e: KonkurrenzEinstellungen) => Promise<void>;
    abbrechen: () => void;
  } = $props();

  const id = Math.random().toString(36).slice(2, 7);
  // svelte-ignore state_referenced_locally
  let e = $state<KonkurrenzEinstellungen>(JSON.parse(JSON.stringify(start)));
  // svelte-ignore state_referenced_locally
  let gesetzte = $state(start.gesetzte === null ? '' : String(start.gesetzte));
  // svelte-ignore state_referenced_locally
  let klassen = $state(start.zulassung.klassen.join(', '));
  // svelte-ignore state_referenced_locally
  let ttrGrenzen = $state(start.ttrGrenzen.join(', '));
  // svelte-ignore state_referenced_locally
  let veroeff = $state<'turnier' | 'offen' | 'verdeckt'>(start.veroeffentlichung === null ? 'turnier' : start.veroeffentlichung.tabellen && start.veroeffentlichung.ko ? 'offen' : 'verdeckt');
  const zahl = (t: string) => (t === '' ? null : Number.isFinite(parseInt(t, 10)) ? parseInt(t, 10) : null);
  // svelte-ignore state_referenced_locally
  let zl = $state({
    ttrMin: start.zulassung.ttrMin?.toString() ?? '',
    ttrMax: start.zulassung.ttrMax?.toString() ?? '',
    jahrgangVon: start.zulassung.jahrgangVon?.toString() ?? '',
    jahrgangBis: start.zulassung.jahrgangBis?.toString() ?? '',
  });
  // svelte-ignore state_referenced_locally
  let runden = $state(start.runden === null ? '' : String(start.runden));
  // svelte-ignore state_referenced_locally
  let mitVorgabe = $state(start.vorgabe !== null);
  // svelte-ignore state_referenced_locally
  let vorgabeJe = $state(start.vorgabe ?? 50);
  let fehler = $state('');
  let sendet = $state(false);
  const rundenModus = $derived(e.modus === 'schweizer' || e.modus === 'cup' || e.modus === 'kaiser');
  const schweizerArt = $derived(e.modus === 'schweizer' || e.modus === 'cup');
  // svelte-ignore state_referenced_locally
  let feste = $state<'normal' | '2' | '4'>(start.festeSaetze ? (String(start.festeSaetze) as '2' | '4') : 'normal');
  // svelte-ignore state_referenced_locally
  let beginn = $state(start.beginn ?? '');
  // svelte-ignore state_referenced_locally
  let startgeld = $state(start.startgeld ? (start.startgeld / 100).toFixed(2).replace('.', ',') : '');
  // svelte-ignore state_referenced_locally
  let maxTeilnehmer = $state(start.maxTeilnehmer === null ? '' : String(start.maxTeilnehmer));
  const mitGruppen = $derived(e.modus === 'jgj' || e.modus === 'gruppen_ko');
  const mitKo = $derived(e.modus !== 'jgj');
  const einfachesKo = $derived(e.modus === 'ko' || e.modus === 'gruppen_ko');
  // Mannschaften: Spielsystem, Durchspielen, eigene Spielfolge
  // svelte-ignore state_referenced_locally
  let system = $state<SystemId>(start.mannschaft?.system ?? 'bundes4');
  // svelte-ignore state_referenced_locally
  let durchspielen = $state(start.mannschaft?.durchspielen ?? false);
  // svelte-ignore state_referenced_locally
  let eigeneFolge = $state(start.mannschaft?.eigen ? folgeText(start.mannschaft.eigen.folge) : 'D1-D1, 1-2, 2-1, 1-1, 2-2');
  const eigenGelesen = $derived(folgeLesen(eigeneFolge));
  const sysVorschau = $derived(
    system === 'eigen'
      ? typeof eigenGelesen === 'string'
        ? null
        : systemVon({ mannschaft: { system: 'eigen', durchspielen, eigen: eigenGelesen } })
      : SYSTEME[system],
  );
  const modiListe = $derived(e.art === 'mannschaft' ? MODI.filter((m) => MODI_MANNSCHAFT.includes(m)) : MODI);
  $effect(() => {
    if (e.art === 'mannschaft' && !MODI_MANNSCHAFT.includes(e.modus)) e.modus = 'gruppen_ko';
  });

  async function absenden(ev: SubmitEvent) {
    ev.preventDefault();
    if (e.name.trim().length < 1) return;
    const geld = centAus(startgeld);
    if (geld === undefined) {
      fehler = T.konk.startgeldFalsch;
      return;
    }
    const max = zahl(maxTeilnehmer);
    let mannschaft = null as KonkurrenzEinstellungen['mannschaft'];
    if (e.art === 'mannschaft') {
      if (system === 'eigen' && typeof eigenGelesen === 'string') {
        fehler = eigenGelesen;
        return;
      }
      mannschaft = { ...standardMannschaft(), system, durchspielen, eigen: system === 'eigen' && typeof eigenGelesen !== 'string' ? eigenGelesen : null };
    }
    const aus: KonkurrenzEinstellungen = {
      ...$state.snapshot(e),
      name: e.name.trim(),
      gesetzte: zahl(gesetzte),
      runden: rundenModus ? zahl(runden) : null,
      festeSaetze: schweizerArt && feste !== 'normal' ? (Number(feste) as 2 | 4) : null,
      beschleunigt: e.modus === 'schweizer' && e.beschleunigt,
      beginn: /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(beginn) ? beginn : null,
      vorgabe: mitVorgabe ? vorgabeJe : null,
      startgeld: geld,
      mannschaft,
      maxTeilnehmer: max !== null && max >= 2 && max <= 1000 ? max : null,
      ttrGrenzen: [...new Set(ttrGrenzen.split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0 && n <= 4000))].sort((a, b) => a - b),
      veroeffentlichung: veroeff === 'turnier' ? null : veroeff === 'offen' ? { tabellen: true, ko: true } : { tabellen: false, ko: false },
      zulassung: {
        ttrMin: zahl(zl.ttrMin),
        ttrMax: zahl(zl.ttrMax),
        jahrgangVon: zahl(zl.jahrgangVon),
        jahrgangBis: zahl(zl.jahrgangBis),
        klassen: klassen.split(',').map((k) => k.trim()).filter(Boolean),
        geschlecht: [...e.zulassung.geschlecht],
        nurHobby: !!e.zulassung.nurHobby,
      },
    };
    sendet = true;
    fehler = '';
    try {
      await speichern(aus);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      sendet = false;
    }
  }
</script>

<form onsubmit={absenden} class="konk-form">
  <label for="kn-{id}">{T.konk.name}</label>
  <input id="kn-{id}" bind:value={e.name} placeholder={T.konk.namePlatzhalter} required maxlength="80" />

  <fieldset disabled={gestartet || mitMeldungen}>
    <legend>{T.konk.art}<Hilfe text={T.konk.artHilfe} /></legend>
    <div class="reihe arten">
      {#each ['einzel', 'doppel', 'mixed', 'mannschaft'] as const as a (a)}
        <label class="wahl klein" class:aktiv={e.art === a}>
          <input type="radio" name="art-{id}" value={a} bind:group={e.art} />
          <span><strong>{T.konk.arten[a]}</strong></span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#if e.art === 'mannschaft'}
    <fieldset disabled={gestartet} class="mannschaft" data-testid="mannschaft-system">
      <legend>{T.mannschaft.system}<Hilfe text={T.mannschaft.systemHilfe} /></legend>
      <select bind:value={system} aria-label={T.mannschaft.system}>
        {#each SYSTEM_REIHE as sid (sid)}<option value={sid}>{sid === 'eigen' ? T.mannschaft.eigen : SYSTEME[sid].name}</option>{/each}
      </select>
      {#if system === 'eigen'}
        <div class="label-zeile"><label for="mf-{id}">{T.mannschaft.folge}</label><Hilfe text={T.mannschaft.folgeHilfe} /></div>
        <textarea id="mf-{id}" bind:value={eigeneFolge} rows="3"></textarea>
        {#if typeof eigenGelesen === 'string'}<div class="meldung fehler" role="alert">{eigenGelesen}</div>{/if}
      {/if}
      {#if sysVorschau}
        <p class="leise" data-testid="system-vorschau">{T.mannschaft.vorschau(sysVorschau.einzel, sysVorschau.doppel, sysVorschau.folge.length, bisSiege(sysVorschau))}</p>
      {/if}
      <label class="haken"><input type="checkbox" bind:checked={durchspielen} /> {T.mannschaft.durchspielen}</label>
    </fieldset>
  {/if}

  <fieldset disabled={gestartet}>
    <legend>{T.konk.modus}</legend>
    {#each modiListe as m (m)}
      <label class="wahl" class:aktiv={e.modus === m}>
        <input type="radio" name="modus-{id}" value={m} bind:group={e.modus} />
        <span><strong>{T.konk.modi[m]}</strong><span class="leise">{T.konk.modiText[m]}</span></span>
      </label>
    {/each}
  </fieldset>

  <div class="raster">
    <div>
      <label for="bo-{id}">{T.konk.bestOf}</label>
      <select id="bo-{id}" bind:value={e.bestOf} disabled={gestartet}>
        {#each [1, 3, 5, 7] as b (b)}<option value={b as BestOf}>{T.konk.bestOfWahl[b]}</option>{/each}
      </select>
    </div>
    {#if rundenModus}
      <div>
        <div class="label-zeile"><label for="rn-{id}">{T.konk.runden}</label><Hilfe text={T.konk.rundenHilfe} /></div>
        <input id="rn-{id}" bind:value={runden} inputmode="numeric" placeholder={T.konk.rundenAuto(e.modus === 'kaiser' ? 7 : e.modus === 'cup' ? 6 : 4)} />
      </div>
    {/if}
    {#if schweizerArt}
      <div>
        <div class="label-zeile"><label for="fs-{id}">{T.konk.festeSaetze}</label><Hilfe text={T.konk.festeSaetzeHilfe} /></div>
        <select id="fs-{id}" bind:value={feste} disabled={gestartet} data-testid="feste-saetze">
          {#each ['normal', '2', '4'] as f (f)}<option value={f}>{T.konk.festeSaetzeWahl[f]}</option>{/each}
        </select>
      </div>
    {/if}
    <div>
      <div class="label-zeile"><label for="ei-{id}">{T.konk.eingabe}</label><Hilfe text={T.konk.eingabeHilfe} /></div>
      <select id="ei-{id}" bind:value={e.eingabe} disabled={gestartet}>
        {#each ['punkte', 'saetze'] as x (x)}<option value={x}>{T.konk.eingabeWahl[x]}</option>{/each}
      </select>
    </div>
    {#if mitGruppen}
      {#if e.modus === 'gruppen_ko'}
        <div>
          <label for="gg-{id}">{T.konk.gruppenGroesse}</label>
          <select id="gg-{id}" bind:value={e.gruppenGroesse} disabled={gestartet}>
            {#each [3, 4, 5, 6, 7, 8] as g (g)}<option value={g}>{g}</option>{/each}
          </select>
        </div>
        <div>
          <label for="au-{id}">{T.konk.aufsteiger}</label>
          <select id="au-{id}" bind:value={e.aufsteiger}>
            {#each [1, 2, 3, 4] as g (g)}<option value={g}>{g}</option>{/each}
          </select>
        </div>
      {/if}
    {/if}
  </div>

  {#if e.modus === 'schweizer'}
    <div class="haken-zeile"><label class="haken"><input type="checkbox" bind:checked={e.beschleunigt} disabled={gestartet} /> {T.konk.beschleunigt}</label><Hilfe text={T.konk.beschleunigtHilfe} /></div>
  {/if}
  {#if mitGruppen}
    <label for="we-{id}">{T.konk.wertung}</label>
    <select id="we-{id}" bind:value={e.wertung}>
      {#each ['dttb', 'ittf'] as w (w)}<option value={w}>{T.konk.wertungWahl[w]}</option>{/each}
    </select>
    <WertungInfo aktiv={e.wertung} />
    <div class="label-zeile"><label for="rz-{id}">{T.konk.rueckzug}</label><Hilfe text={T.konk.rueckzugHilfe} /></div>
    <select id="rz-{id}" bind:value={e.rueckzug}>
      {#each ['wo', 'hobby'] as w (w)}<option value={w}>{T.konk.rueckzugWahl[w]}</option>{/each}
    </select>
  {/if}
  <div class="haken-zeile"><label class="haken"><input type="checkbox" bind:checked={mitVorgabe} /> {T.konk.vorgabe}</label><Hilfe text={T.konk.vorgabeHilfe} /></div>
  {#if mitVorgabe}
    <div class="raster">
      <div>
        <label for="vj-{id}">{T.konk.vorgabeJe}</label>
        <select id="vj-{id}" bind:value={vorgabeJe}>
          {#each [25, 30, 40, 50, 75, 100] as w (w)}<option value={w}>{w}</option>{/each}
        </select>
      </div>
      <div>
        <label for="vm-{id}">{T.konk.vorgabeMax}</label>
        <select id="vm-{id}" bind:value={e.vorgabeMax}>
          {#each [3, 4, 5, 6, 7, 8, 9, 10] as w (w)}<option value={w}>{w}</option>{/each}
        </select>
      </div>
    </div>
    <p class="leise">{T.konk.vorgabeBeispiel(vorgabeJe, e.vorgabeMax)}</p>
  {/if}
  {#if einfachesKo}
    <label class="haken"><input type="checkbox" bind:checked={e.platz3} /> {T.konk.platz3}</label>
    <div class="haken-zeile"><label class="haken"><input type="checkbox" bind:checked={e.trostrunde} /> {T.konk.trostrunde}</label><Hilfe text={T.konk.trostrundeHilfe} /></div>
  {:else if e.modus === 'doppel_ko'}
    <div class="haken-zeile"><label class="haken"><input type="checkbox" bind:checked={e.finaleWiederholung} /> {T.konk.finaleWiederholung}</label><Hilfe text={T.konk.finaleWiederholungHilfe} /></div>
  {/if}

  {#if e.modus === 'gruppen_ko'}
    <h3>{T.konk.trennungTitel}<Hilfe text={T.konk.trennungHilfe} /></h3>
    <label for="kt-{id}">{T.konk.trennung}</label>
    <select id="kt-{id}" bind:value={e.klassenTrennung} disabled={gestartet}>
      {#each ['keine', 'klasse', 'ttr'] as w (w)}<option value={w}>{T.konk.trennungWahl[w]}</option>{/each}
    </select>
    {#if e.klassenTrennung === 'ttr'}
      <TtrGrenzenWahl bind:wert={ttrGrenzen} {id} disabled={gestartet} />
    {/if}
  {/if}

  <div class="raster">
    <div>
      <div class="label-zeile"><label for="sg-{id}">{T.konk.startgeld}</label><Hilfe text={T.konk.startgeldHilfe} /></div>
      <input id="sg-{id}" bind:value={startgeld} inputmode="decimal" placeholder="0,00" data-testid="startgeld" />
    </div>
    <div>
      <div class="label-zeile"><label for="mt-{id}">{T.konk.maxTeilnehmer}</label><Hilfe text={T.konk.maxTeilnehmerHilfe} /></div>
      <input id="mt-{id}" bind:value={maxTeilnehmer} inputmode="numeric" placeholder={T.konk.unbegrenzt} data-testid="max-teilnehmer" />
    </div>
  </div>
  <details class="weitere">
    <summary>{T.konk.weitere}</summary>
    <div class="raster">
      <div>
        <label for="se-{id}">{T.konk.setzung}</label>
        <select id="se-{id}" bind:value={e.setzung} disabled={gestartet}>
          {#each ['ttr', 'manuell', 'keine'] as s (s)}<option value={s}>{T.konk.setzungWahl[s]}</option>{/each}
        </select>
      </div>
      <div>
        <div class="label-zeile"><label for="gs-{id}">{T.konk.gesetzte}</label><Hilfe text={T.konk.gesetzteHilfe} /></div>
        <input id="gs-{id}" bind:value={gesetzte} inputmode="numeric" placeholder={T.konk.gesetzteAuto} disabled={gestartet || e.setzung === 'keine'} />
      </div>
    </div>
    <label class="haken"><input type="checkbox" bind:checked={e.vereinstrennung} disabled={gestartet} /> {T.konk.vereine}</label>
    <div class="label-zeile"><label for="bg-{id}">{T.konk.beginn}</label><Hilfe text={T.konk.beginnHilfe} /></div>
    <input id="bg-{id}" type="time" bind:value={beginn} class="zeit" />

    <h3>{T.konk.zulassung}</h3>
    <p class="leise">{T.konk.zulassungText}</p>
    <div class="raster">
      <div><label for="t1-{id}">{T.konk.ttrMin}</label><input id="t1-{id}" bind:value={zl.ttrMin} inputmode="numeric" /></div>
      <div><label for="t2-{id}">{T.konk.ttrMax}</label><input id="t2-{id}" bind:value={zl.ttrMax} inputmode="numeric" /></div>
      <div><label for="j1-{id}">{T.konk.jahrgangVon}</label><input id="j1-{id}" bind:value={zl.jahrgangVon} inputmode="numeric" /></div>
      <div><label for="j2-{id}">{T.konk.jahrgangBis}</label><input id="j2-{id}" bind:value={zl.jahrgangBis} inputmode="numeric" /></div>
    </div>
    <div class="haken-zeile"><label class="haken"><input type="checkbox" bind:checked={e.zulassung.nurHobby} /> {T.konk.nurHobby}</label><Hilfe text={T.konk.nurHobbyHilfe} /></div>
    <label for="kl-{id}">{T.konk.klassen}</label>
    <input id="kl-{id}" bind:value={klassen} placeholder={klassenStore.liste.length ? klassenStore.liste.slice(0, 3).join(', ') : 'Anfänger, Fortgeschritten'} list="klassen-vorschlag" />
    <datalist id="klassen-vorschlag">{#each klassenStore.liste as k (k)}<option value={k}></option>{/each}</datalist>
    <fieldset>
      <legend>{T.konk.geschlecht}</legend>
      <div class="reihe">
        {#each ['m', 'w', 'd'] as g (g)}
          <label class="haken"><input type="checkbox" value={g as Geschlecht} bind:group={e.zulassung.geschlecht} /> {T.tspieler.geschlechter[g]}</label>
        {/each}
      </div>
    </fieldset>

    <h3>{T.konk.veroeffTitel}<Hilfe text={T.einstellungen.veroeffText} /></h3>
    <select bind:value={veroeff} aria-label={T.konk.veroeffTitel}>
      {#each ['turnier', 'offen', 'verdeckt'] as w (w)}<option value={w}>{T.konk.veroeffWahl[w]}</option>{/each}
    </select>
  </details>

  {#if gestartet}<p class="leise">{T.konk.festNachStart}</p>{/if}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe" style="margin-top:12px">
    <button type="submit" disabled={sendet || !e.name.trim()}>{knopf}</button>
    <button type="button" class="zweit" onclick={abbrechen}>{T.app.abbrechen}</button>
  </div>
</form>

<style>
  .raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 480px) {
    .raster { grid-template-columns: 1fr; }
  }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 12px 0 6px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken-zeile { display: flex; align-items: center; gap: 4px; }
  .haken-zeile .haken { margin: 6px 0; }
  .weitere { margin-top: 16px; }
  .arten { gap: 8px; }
  .arten .wahl { flex: 1 1 0; justify-content: center; padding: 10px 8px; margin: 0; }
  legend { display: flex; align-items: center; }
  .weitere summary { font-size: 1rem; }
  h3 { margin-top: 16px; }
  .zeit { max-width: 10rem; }
  .mannschaft textarea { width: 100%; }
</style>
