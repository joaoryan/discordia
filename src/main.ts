import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource-variable/inter/wght.css';
import './app.css';

mount(App, { target: document.getElementById('app')! });
