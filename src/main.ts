import { mount } from 'svelte';
import App from './App.svelte';
import { unlockSounds } from './lib/sounds';
import '@fontsource-variable/inter/wght.css';
import './app.css';

unlockSounds();
mount(App, { target: document.getElementById('app')! });
