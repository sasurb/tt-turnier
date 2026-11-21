import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const ziel = document.getElementById('app');
if (!ziel) throw new Error('#app fehlt');

export default mount(App, { target: ziel });

// Offline-Betrieb: App-Dateien auf dem Gerät zwischenspeichern (siehe sw/sw-vorlage.js)
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
