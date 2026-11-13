import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const ziel = document.getElementById('app');
if (!ziel) throw new Error('#app fehlt');

export default mount(App, { target: ziel });
