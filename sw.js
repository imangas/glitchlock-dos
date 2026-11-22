// SPDX-License-Identifier: GPL-2.0-or-later
//
// GlitchLock-DOS - games launcher for any device
// Copyright (C) 2026 Nacho Mangas
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
const CACHE_NAME = "dos-pwa-v0.16.1"; // x-release-please-version

// 1. URLs exactas a precargar en la instalación
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/main.js',
  './js/games-config.js',
  './css/styles.css',
];

const CDN_ASSETS = [
  'https://v8.js-dos.com/latest/js-dos.js',
  'https://v8.js-dos.com/latest/js-dos.css',
  'https://v8.js-dos.com/latest/emulators/emulators.js',
  'https://v8.js-dos.com/latest/emulators/wdosbox.js',
  'https://v8.js-dos.com/latest/emulators/wdosbox.wasm',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Local files must be cached, or the installation fails
      await cache.addAll(LOCAL_ASSETS);

      // CDN files are best effort: one failure must not abort the installation
      const results = await Promise.allSettled(CDN_ASSETS.map((url) => cache.add(url)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn('[SW] Not cached:', CDN_ASSETS[index]);
        }
      });
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 2. Interceptador universal: Sirve desde caché y guarda dinámicamente (.woff2 de gstatic)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Si ya está guardado (HTML, JS, CSS o la fuente .woff2), se devuelve
      if (cachedResponse) {
        return cachedResponse;
      }

      // Si no está (por ejemplo, la primera vez que carga un archivo .woff2 desde fonts.gstatic.com)
      return fetch(event.request).then((networkResponse) => {
        // Validar respuesta correcta
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        // Guardar una copia en la Cache Storage para el futuro uso offline
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
