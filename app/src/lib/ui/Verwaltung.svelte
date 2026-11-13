<script lang="ts">
  import { onMount } from 'svelte';
  import type { Konto } from '@shared/protokoll';
  import { T } from '../texte';
  import { api } from '../dienste';

  let { token, eigeneId, beiAblauf }: { token: string; eigeneId: number; beiAblauf: (x: unknown) => boolean } = $props();

  let konten = $state<Konto[]>([]);
  let name = $state('');
  let email = $state('');
  let passwort = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let laeuft = $state(false);

  async function laden() {
    try {
      konten = (await api.konten(token)).konten;
    } catch (x) {
      if (!beiAblauf(x)) meldung = { ok: false, text: x instanceof Error ? x.message : T.app.fehlerAllgemein };
    }
  }
  onMount(laden);

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    laeuft = true;
    meldung = null;
    try {
      await api.kontoAnlegen(token, { name: name.trim(), email: email.trim(), passwort });
      meldung = { ok: true, text: T.admin.angelegt };
      name = email = passwort = '';
      await laden();
    } catch (x) {
      if (!beiAblauf(x)) meldung = { ok: false, text: x instanceof Error ? x.message : T.app.fehlerAllgemein };
    } finally {
      laeuft = false;
    }
  }

  async function umschalten(k: Konto) {
    try {
      await api.kontoSperren(token, k.id, !k.gesperrt);
      await laden();
    } catch (x) {
      if (!beiAblauf(x)) meldung = { ok: false, text: x instanceof Error ? x.message : T.app.fehlerAllgemein };
    }
  }

  function wann(iso: string | null) {
    return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : T.admin.nie;
  }
</script>

<section class="karte">
  <h2>{T.admin.titel} · {T.admin.konten}</h2>
  <ul class="liste">
    {#each konten as k (k.id)}
      <li class="reihe">
        <div class="wachsen">
          <strong>{k.name}</strong>
          <span class="marke">{k.rolle === 'admin' ? T.admin.rolleAdmin : T.admin.rolleVeranstalter}</span>
          {#if k.gesperrt}<span class="marke gesperrt">{T.admin.gesperrt}</span>{/if}
          <br /><span class="leise">{k.email}</span>
          <br /><span class="leise">{T.admin.letzteAnmeldung}: {wann(k.letzteAnmeldung)} · {T.admin.turniere}: {k.turniere ?? 0}</span>
        </div>
        {#if k.id !== eigeneId}
          <button class="klein" class:gefahr={!k.gesperrt} class:zweit={k.gesperrt} onclick={() => umschalten(k)}>
            {k.gesperrt ? T.admin.entsperren : T.admin.sperren}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <details>
    <summary>{T.admin.neuesKonto}</summary>
    <form onsubmit={anlegen}>
      <label for="kn">{T.admin.name}</label>
      <input id="kn" bind:value={name} required minlength="2" autocomplete="off" />
      <label for="ke">{T.admin.email}</label>
      <input id="ke" type="email" bind:value={email} required autocomplete="off" />
      <label for="kp">{T.admin.passwort}</label>
      <input id="kp" bind:value={passwort} required minlength="8" autocomplete="off" />
      <button type="submit" style="margin-top:12px" disabled={laeuft}>{T.admin.anlegen}</button>
    </form>
  </details>
  {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
</section>

<style>
  .gesperrt { color: var(--rot); border-color: var(--rot); }
</style>
