import { mountNeuralDefence } from './app.js';
import { createBrowserMapRepository } from './map-repository.js';
import { createPreferencesStore } from './preferences.js';
import { createSession } from '../online/session.js';
import './neural-defence.css';

const root = document.getElementById('app');
if (!root) throw new Error('Neural Defence mount point is missing');

mountNeuralDefence(root, {
  maps: createBrowserMapRepository(fetch.bind(globalThis)),
  preferences: createPreferencesStore(localStorage),
  createSession,
  debug: new URLSearchParams(location.search).has('debug'),
  animationClock: () => performance.now(),
  requestFrame: callback => requestAnimationFrame(callback),
  cancelFrame: handle => cancelAnimationFrame(handle),
});
