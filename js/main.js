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

const VERSION = "0.13.0"; // x-release-please-version
const SNAPSHOTS = "snapshots";
const SAVE_MODE_FILE = "file";
const SAVE_MODE_PERSIST = "persist";
const GAMES_CONFIG_FILENAME = "games-config.json";
const GAME_GRID = document.getElementById("game_grid");
const SAVEGAMES = "savegames";
const SNAPSHOT_EXTENSION = ".jsdos";
const SIZE_UNITS = ["b", "kb", "mb", "gb"];
const MAX_SEARCH_RESULTS = 5;
const GAME_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const GAME_KEY_INVALID_CHARS = /[^a-zA-Z0-9_-]/g;
let isGameRuning = false;
let activeCi = null;
let gameRuningId = null;
let bundleUrl = null;

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function formatFileSize(bytes) {
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // One decimal at most, without trailing zeros: 20kb, 1.5mb
  return `${Number(value.toFixed(1))}${SIZE_UNITS[unitIndex]}`;
}

function getSaveMode(gameConfig) {
  return gameConfig?.jsDos?.saveMode ?? SAVE_MODE_FILE;
}

// Games that can be reused: the saved ones plus the defaults from games-config.js
// (the saved copy wins when a key exists in both).
function getKnownGames() {
  const known = { ...window.defaultGamesData, ...window.gamesData };
  return Object.entries(known)
    .filter(([key]) => key !== "generic")
    .map(([key, config]) => ({ key, name: config.name || key }));
}

function searchGames(games, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return games
    .filter(
      ({ key, name }) => key.toLowerCase().includes(needle) || name.toLowerCase().includes(needle),
    )
    .slice(0, MAX_SEARCH_RESULTS);
}

function describeKey(games, key) {
  const match = games.find((game) => game.key === key);
  if (match) {
    return { isExisting: true, message: `Existing configuration will be used: ${match.name}` };
  }
  return {
    isExisting: false,
    message: "A new entry will be created from the generic configuration.",
  };
}

async function saveGamesConfigToOPFS() {
  try {
    const json = JSON.stringify(window.gamesData, null, 2);
    await writeOpfsFile([], GAMES_CONFIG_FILENAME, json);
    console.log("[OPFS] games-config saved.");
  } catch (err) {
    console.error("[OPFS] Failed to save games-config:", err);
  }
}

async function initGamesConfig() {
  window.defaultGamesData = structuredClone(window.gamesData);

  const bytes = await readOpfsFile([], GAMES_CONFIG_FILENAME);
  if (!bytes) {
    await saveGamesConfigToOPFS();
    console.log("[OPFS] No games-config found. Default copy created.");
    return;
  }

  try {
    window.gamesData = JSON.parse(new TextDecoder().decode(bytes));
    console.log("[OPFS] games-config loaded.");
  } catch (err) {
    console.error("[OPFS] games-config is corrupted, using the defaults:", err);
  }
}

function getGameIdByFilename(filename) {
  return filename.replace(".zip", "");
}

function getGameConfigByGameId(gameId) {
  return window.gamesData[gameId] || window.gamesData.generic;
}

function getDefaultGameConfigByGameId(gameId) {
  return window.defaultGamesData?.[gameId] || window.defaultGamesData?.generic;
}

async function loadList() {
  const games = await listInstalledGames();
  GAME_GRID.replaceChildren(...games.map(buildGameCard));
}

function closeDetailPanel() {
  const detailPanel = document.getElementById("detail-panel");
  detailPanel.style.display = "none";
  detailPanel.innerHTML = "";
  gameRuningId = null;
}

async function loadGameDetails(handle, name, gameId) {
  const detailPanel = document.getElementById("detail-panel");
  detailPanel.style.display = "block";
  detailPanel.innerHTML = "";
  gameRuningId = gameId;
  const gameConfig = getGameConfigByGameId(gameRuningId);

  const closeButtonRow = document.createElement("div");
  closeButtonRow.className = "md:hidden flex justify-end mb-4";
  closeButtonRow.innerHTML = `
          <button id="close-detail-panel-button" class="text-[#c7c6c6] hover:text-primary p-2 -m-2">
            <span class="material-symbols-outlined text-xl">close</span>
          </button>
        `;
  detailPanel.append(closeButtonRow);

  const gameDetails = document.createElement("div");
  gameDetails.innerHTML = `<div class="mb-6 flex flex-col gap-4">
          <div class="border border-primary/40 p-1">
            <div
              class="bg-black aspect-video overflow-hidden border border-primary/20 relative"
            >
              <img
                class="w-full h-full object-cover contrast-150"
                data-alt="Detailed screenshot of Monkey Island game art"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCEpT0dHBPGe6uQyZGf3uKs6S01RnwhsbMOeYQXh-oE1n6h2Kbg63VJbNle-kEkcq2kpAXlw00c4Ez_iBc9tMJeauDT4RC3qxRlfPkcJDT9Pl68OWF96Hk9X4vjd1BPWQXm6DeuvOsxDNy5H2FqzkJRxWCEt_Jpq25Jl1oqx3D5AT-IQUEpuQaQc6v5IEIy3izO8jP0CZ-xlouvgsgJGbUxriJlGeGrSRuZsDp1sgBNGFIHzrH2m-2pehzr3wRyvz6S8mLAKfyR82M"
              />
              <div
                class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"
              ></div>
              <div class="absolute bottom-2 left-2 text-[8px] text-primary/70">
                SCR_DMP_0041.PCX
              </div>
            </div>
          </div>
          <div class="space-y-4">
            <h2
              class="text-xl font-bold text-primary phosphor-glow tracking-tight uppercase"
            >
              ${escapeHtml(gameConfig.name)}
            </h2>
          </div>
        </div>
        <div class="recessed-panel bg-surface-container-lowest p-4 mb-6 border-b border-r border-outline-variant/20">
          <p class="text-[10px] leading-relaxed text-secondary-fixed-dim line-clamp-6">
              ${escapeHtml(gameConfig.description)}
          </p>
        </div>`;

  const gameButtons = document.createElement("div");
  gameButtons.className = "mt-auto flex flex-col gap-3";
  gameDetails.append(gameButtons);

  const gameButtonLaunch = document.createElement("button");
  gameButtonLaunch.className =
    "w-full bg-[#57d9d9] text-[#003737] py-4 text-center font-extrabold text-lg tracking-[0.2em] shadow-[0_0_20px_rgba(87,217,217,0.2)] hover:brightness-110 active:scale-95 transition-all";
  gameButtonLaunch.textContent = "LAUNCH";
  gameButtonLaunch.onclick = () => loadGameBlob(handle);
  gameButtons.append(gameButtonLaunch);

  const gameExtraButtons = document.createElement("div");
  gameExtraButtons.className = "flex gap-2";
  gameButtons.append(gameExtraButtons);

  const gameButtonSetup = document.createElement("button");
  gameButtonSetup.className =
    "flex-1 bg-surface-container-high text-secondary py-2 text-[10px] font-bold uppercase tracking-wider border border-outline-variant/30 hover:bg-surface-variant";
  gameButtonSetup.textContent = "⚙ SETUP";
  gameButtonSetup.onclick = () => setupGame(name, handle);
  gameExtraButtons.append(gameButtonSetup);

  const gameButtonDelete = document.createElement("button");
  gameButtonDelete.className =
    "flex-1 bg-surface-container-high text-secondary py-2 text-[10px] font-bold uppercase tracking-wider border border-outline-variant/30 hover:bg-surface-variant";
  gameButtonDelete.textContent = "🗑️ UNINSTALL";
  gameButtonDelete.onclick = () => deleteGame(gameId);
  gameExtraButtons.append(gameButtonDelete);

  const mobileSetupContainer = document.createElement("div");
  mobileSetupContainer.id = "mobile-setup-container";
  mobileSetupContainer.className = "md:hidden mt-6";
  gameDetails.append(mobileSetupContainer);

  detailPanel.append(gameDetails);
  document.getElementById("close-detail-panel-button").onclick =
    closeDetailPanel;
}

function buildGameConfigFormElement(gameConfig, { onSaved, onCancelled }) {
  const wrapper = document.createElement("div");
  wrapper.className = "grid grid-cols-1 gap-10 md:col-span-2 lg:col-span-3";

  wrapper.innerHTML = `<form name="gameConfig" action="void 0">
            <!-- Section: Game Info -->
            <div class="space-y-6">
              <div class="flex items-center gap-2 mb-4">
                <span class="text-tertiary font-bold">00.</span>
                <h2 class="text-on-surface font-bold uppercase text-sm tracking-widest">Game Info</h2>
                <div class="flex-1 border-t border-outline-variant/30 ml-4"></div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div class="space-y-2">
              <label class="block text-[10px] text-secondary font-bold uppercase">Name</label>
              <input name="name" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" type="text" value="${escapeHtml(gameConfig.name)}">
              </div>
              <div class="space-y-2">
              <label class="block text-[10px] text-secondary font-bold uppercase">Wallscroll (image path/URL)</label>
              <input name="wallscroll" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" type="text" value="${escapeHtml(gameConfig.wallscroll)}">
              </div>
              </div>
            </div>

            <!-- Section: Identity -->
            ${buildSaveGameSectionHtml(gameConfig)}

            <div class="space-y-6">
              <div class="flex items-center gap-2 mb-4">
              <span class="text-tertiary font-bold">03.</span>
              <h2 class="text-on-surface font-bold uppercase text-sm tracking-widest">DOSBOX CONFIGURATIONS</h2>
              <div class="flex-1 border-t border-outline-variant/30 ml-4"></div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div class="space-y-2">
              <label class="block text-[10px] text-secondary font-bold uppercase">opfs Save File Path</label>
              <textarea name="dosboxConfig" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" rows="7">${escapeHtml(gameConfig.dosboxConfig)}</textarea>
              </div>
              </div>
            </div>

            <div class="space-y-6">
              <div class="flex items-center gap-2 mb-4">
                <span class="text-tertiary font-bold">04.</span>
                <h2 class="text-on-surface font-bold uppercase text-sm tracking-widest">Emulator Config</h2>
                <div class="flex-1 border-t border-outline-variant/30 ml-4"></div>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="mouseCapture"
                  id="mouseCapture"
                  class="w-4 h-4 accent-primary bg-surface-container-low border border-outline"
                  ${gameConfig?.jsDos?.mouseCapture ? "checked" : ""}
                />
                <label for="mouseCapture" class="text-[10px] text-secondary font-bold uppercase">Mouse Capture</label>
              </div>
            </div>
          </form>

          <!-- Final Actions -->
          <div class="pt-6 pb-6 md:pb-24 flex gap-4" id="setup_action_buttons"></div>
        `;
  bindSaveModeToggle(wrapper);

  const setupActionButtons = wrapper.querySelector("#setup_action_buttons");

  const saveConfigActionButton = document.createElement("button");
  saveConfigActionButton.className =
    "bg-[#57d9d9] text-[#003737] px-10 py-4 font-black uppercase text-sm hover:bg-[#003737] hover:text-[#57d9d9] transition-colors duration-75 flex items-center gap-3";
  saveConfigActionButton.innerHTML =
    '<span class="material-symbols-outlined text-sm">save</span>SAVE CHANGES';
  setupActionButtons.append(saveConfigActionButton);

  const cancelActionButton = document.createElement("button");
  cancelActionButton.className =
    "bg-surface-container-highest text-on-surface border border-outline-variant/30 px-10 py-4 font-bold uppercase text-sm hover:bg-error hover:text-on-error transition-colors duration-75";
  cancelActionButton.innerText = "CANCEL";
  setupActionButtons.append(cancelActionButton);

  const resetConfigActionButton = document.createElement("button");
  resetConfigActionButton.className =
    "bg-surface-container-highest text-tertiary border border-tertiary/30 px-10 py-4 font-bold uppercase text-sm hover:bg-tertiary hover:text-on-tertiary transition-colors duration-75 flex items-center gap-3";
  resetConfigActionButton.innerHTML =
    '<span class="material-symbols-outlined text-sm">restart_alt</span>RESET TO DEFAULTS';
  setupActionButtons.append(resetConfigActionButton);

  resetConfigActionButton.onclick = () => {
    if (!confirm("Reset this game's configuration to the repository defaults? Unsaved changes will be lost.")) {
      return;
    }

    const defaultConfig = getDefaultGameConfigByGameId(gameRuningId);
    if (!defaultConfig) {
      alert(`No default configuration found for this game (${gameRuningId}).`);
      return;
    }

    window.gamesData[gameRuningId] = structuredClone(defaultConfig);
    saveGamesConfigToOPFS();
    onSaved();
  };

  saveConfigActionButton.onclick = () => {
    const configForm = wrapper.querySelector('form[name="gameConfig"]');
    window.gamesData[gameRuningId].name = configForm.name.value;
    window.gamesData[gameRuningId].wallscroll = configForm.wallscroll.value;
    window.gamesData[gameRuningId].dosSaveFilePath = configForm.dosSaveFilePath.value;
    window.gamesData[gameRuningId].dosSaveFileName =
      configForm.dosSaveFileName.value;
    window.gamesData[gameRuningId].opfsSaveFilePath =
      configForm.opfsSaveFilePath.value;
    window.gamesData[gameRuningId].dosboxConfig = configForm.dosboxConfig.value;
    window.gamesData[gameRuningId].jsDos = {
      ...window.gamesData[gameRuningId].jsDos,
      mouseCapture: configForm.mouseCapture.checked,
      saveMode: configForm.saveModePersist.checked ? SAVE_MODE_PERSIST : SAVE_MODE_FILE,
    };
    saveGamesConfigToOPFS();
    onSaved();
  };

  cancelActionButton.onclick = () => onCancelled();

  return wrapper;
}

function buildSaveGameSectionHtml(gameConfig) {
  const isPersist = getSaveMode(gameConfig) === SAVE_MODE_PERSIST;

  return `
    <div class="space-y-6">
      <div class="flex items-center gap-2 mb-4">
        <span class="text-tertiary font-bold">01.</span>
        <h2 class="text-on-surface font-bold uppercase text-sm tracking-widest">Save Game</h2>
        <div class="flex-1 border-t border-outline-variant/30 ml-4"></div>
      </div>

      <div class="flex items-center gap-4">
        <label class="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            name="saveModePersist"
            class="sr-only peer"
            ${isPersist ? "checked" : ""}
          />
          <div class="w-11 h-6 bg-surface-container-high border border-outline rounded-full relative transition-colors peer-checked:bg-primary/30 peer-checked:border-primary after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:w-4 after:h-4 after:rounded-full after:bg-secondary after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-primary"></div>
        </label>
        <div>
          <p class="text-[10px] text-secondary font-bold uppercase">Save method</p>
          <p class="text-[10px] text-secondary-fixed-dim">
            OFF: single save file &middot; ON: full emulator image
          </p>
        </div>
      </div>

      <div id="save-file-fields">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div class="space-y-2">
            <label class="block text-[10px] text-secondary font-bold uppercase">dos Save File Path</label>
            <input name="dosSaveFilePath" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" type="text" value="${escapeHtml(gameConfig.dosSaveFilePath)}">
          </div>
          <div class="space-y-2">
            <label class="block text-[10px] text-secondary font-bold uppercase">dos Save File Name</label>
            <input name="dosSaveFileName" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" type="text" value="${escapeHtml(gameConfig.dosSaveFileName)}">
          </div>
          <div class="space-y-2">
            <label class="block text-[10px] text-secondary font-bold uppercase">opfs Save File Path</label>
            <input name="opfsSaveFilePath" class="w-full bg-surface-container-low border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors" type="text" value="${escapeHtml(gameConfig.opfsSaveFilePath)}">
          </div>
        </div>
      </div>
    </div>
  `;
}

// Shows the save file fields only while the save method is "single save file".
// The fields stay in the form when hidden, so their values are kept and saved.
function bindSaveModeToggle(root) {
  const toggle = root.querySelector('input[name="saveModePersist"]');
  const pathFields = root.querySelector("#save-file-fields");

  const updateVisibility = () => pathFields.classList.toggle("hidden", toggle.checked);
  toggle.addEventListener("change", updateVisibility);
  updateVisibility();
}

function isSaveFileConfigured(config) {
  return Boolean(config.dosSaveFileName && config.opfsSaveFilePath);
}

// Path of the save file inside the DOS filesystem, e.g. "FATE/SAVEGAME.001"
function getDosSavePath(config) {
  return [config.dosSaveFilePath, config.dosSaveFileName]
    .filter((part) => part && part !== ".")
    .join("/");
}

// Overlays the snapshot files on top of the game ZIP (in memory).
async function applySnapshotToZip(zip, snapshotBytes) {
  const snapshotZip = await JSZip.loadAsync(snapshotBytes);

  // DOS paths are case-insensitive: reuse the path already present in the ZIP
  const existingPaths = new Map();
  zip.forEach((relativePath) => existingPaths.set(relativePath.toLowerCase(), relativePath));

  const appliedPaths = [];
  for (const [path, entry] of Object.entries(snapshotZip.files)) {
    // Never overwrite the injected config (.jsdos/dosbox.conf)
    if (entry.dir || path.startsWith(".jsdos/")) continue;
    const targetPath = existingPaths.get(path.toLowerCase()) ?? path;
    zip.file(targetPath, await entry.async("uint8array"));
    appliedPaths.push(targetPath);
  }
  console.log(`[OPFS] Snapshot applied (${appliedPaths.length} files):`, appliedPaths);
}

const SAVE_STRATEGIES = {
  [SAVE_MODE_FILE]: {
    async restore(zip, gameId, config) {
      if (!isSaveFileConfigured(config)) return;

      const path = [SAVEGAMES, config.opfsSaveFilePath];
      const bytes = await readOpfsFile(path, config.dosSaveFileName);
      if (!bytes) {
        console.log(`[OPFS] No previous save found for: ${gameId}`);
        return;
      }

      zip.file(getDosSavePath(config), bytes);
      console.log(`[OPFS] Save file injected into the bundle: ${config.dosSaveFileName}`);
    },

    async save(ci, gameId, config) {
      if (!isSaveFileConfigured(config)) {
        throw new Error("This game has no save file configured. Check its setup.");
      }

      const bytes = await ci.fsReadFile(getDosSavePath(config));
      if (!bytes?.length) {
        throw new Error(`The save file is missing or empty: ${getDosSavePath(config)}`);
      }

      await writeOpfsFile([SAVEGAMES, config.opfsSaveFilePath], config.dosSaveFileName, bytes);
      console.log(`[OPFS] Save file exported: ${SAVEGAMES}/${config.opfsSaveFilePath}`);
    },
  },

  [SAVE_MODE_PERSIST]: {
    async restore(zip, gameId) {
      const bytes = await readOpfsFile([SNAPSHOTS], getSnapshotFileName(gameId));
      if (bytes) await applySnapshotToZip(zip, bytes);
    },

    async save(ci, gameId) {
      // persist() can return null (no changes) or an object (sockdrive)
      const changes = await ci.persist(true);
      if (!(changes instanceof Uint8Array) || changes.length === 0) {
        throw new Error("The emulator has no changes to save.");
      }

      await writeOpfsFile([SNAPSHOTS], getSnapshotFileName(gameId), changes);
      console.log(`[OPFS] Snapshot saved: ${SNAPSHOTS}/${getSnapshotFileName(gameId)}`);
    },
  },
};

function getSaveStrategy(config) {
  return SAVE_STRATEGIES[getSaveMode(config)] ?? SAVE_STRATEGIES[SAVE_MODE_FILE];
}

async function loadGameBlob(fileHandle) {
  const container = document.getElementById("game-panel");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const detailPanel = document.getElementById("detail-panel");
  const config = getGameConfigByGameId(gameRuningId);

  container.style.display = "block";
  dashboardPanel.style.display = "none";
  detailPanel.style.display = "none";
  container.innerHTML =
    '<p class="m-auto text-primary text-xs uppercase tracking-widest">Loading game...</p>';

  try {
    const disc = await prepareDisc(gameRuningId);
    await saveDiscMount(gameRuningId, disc?.image);
    const zip = await openGameZip(fileHandle);
    zip.file(".jsdos/dosbox.conf", withDiscMount(config.dosboxConfig, disc?.image));

    // Restore the previous progress according to the game's save mode
    await getSaveStrategy(config).restore(zip, gameRuningId, config);
    const initFs = attachDisc(zip, disc);

    const bundleBlob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
    bundleUrl = URL.createObjectURL(bundleBlob);

    container.innerHTML = "";
    markLaunchStarted(gameRuningId);
    await startGame({ container, url: bundleUrl, jsDosConfig: config.jsDos, initFs });
  } catch (err) {
    console.error("Failed to prepare the game:", err);
    container.innerHTML = "";
    container.style.display = "none";
    dashboardPanel.style.display = "";
    alert("The game could not be loaded. It may be too large for this device.");
  }
}

function setupGame(name, handle) {
  const gameConfig = getGameConfigByGameId(gameRuningId);
  const isMobile = window.matchMedia("(max-width: 767px)").matches;

  if (isMobile) {
    const mobileContainer = document.getElementById("mobile-setup-container");
    if (!mobileContainer) return;

    mobileContainer.innerHTML = "";
    const formEl = buildGameConfigFormElement(gameConfig, {
      onSaved: () => {
        loadList();
        loadGameDetails(handle, name, gameRuningId);
      },
      onCancelled: () => {
        mobileContainer.innerHTML = "";
      },
    });
    mobileContainer.append(formEl);
  } else {
    const gridEl = document.getElementById("game_grid");
    gridEl.innerHTML = "";
    const formEl = buildGameConfigFormElement(gameConfig, {
      onSaved: () => loadList(),
      onCancelled: () => loadList(),
    });
    gridEl.append(formEl);
  }
}

async function deleteGame(gameId) {
  const name = getGameConfigByGameId(gameId)?.name ?? gameId;
  const confirmed = await showConfirmModal({
    title: "Uninstall game",
    message: `"${name}", its disc image and its snapshot will be deleted. Its save files are kept.`,
    confirmLabel: "UNINSTALL",
  });
  if (!confirmed) return;

  try {
    await removeOpfsFile([], `${gameId}.zip`);
    await removeOpfsDirectory([DISCS], gameId);
    await removeOpfsFile([SNAPSHOTS], getSnapshotFileName(gameId));

    if (gameId !== "generic" && window.gamesData[gameId]) {
      delete window.gamesData[gameId];
      await saveGamesConfigToOPFS();
    }
  } catch (err) {
    console.error("Failed to delete game:", err);
    alert("The game could not be deleted.");
  }

  closeDetailPanel();
  renderOpfsTree();
  loadList();
}


async function deleteSavedFile(path, fileName) {
  const fullPath = [...path, fileName].join("/");

  const confirmed = await showConfirmModal({
    title: "Delete file",
    message: `"${fullPath}" will be permanently deleted. This cannot be undone.`,
    confirmLabel: "DELETE",
  });
  if (!confirmed) return;

  const removed = await removeOpfsFile(path, fileName);
  if (!removed) {
    alert("The file could not be deleted.");
    return;
  }

  console.log(`[OPFS] File deleted: ${fullPath}`);
  await removeOpfsDirectoryIfEmpty(path)
  await renderOpfsTree();
}

async function getOpfsDirectory(path = [], create = false) {
  let directory = await navigator.storage.getDirectory();
  for (const name of path) {
    directory = await directory.getDirectoryHandle(name, { create });
  }
  return directory;
}

async function readOpfsFile(path, fileName) {
  try {
    const directory = await getOpfsDirectory(path);
    const fileHandle = await directory.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } catch (err) {
    if (err.name !== "NotFoundError") {
      console.error(`[OPFS] Failed to read ${[...path, fileName].join("/")}:`, err);
    }
    return null;
  }
}

async function writeOpfsFile(path, fileName, data) {
  const directory = await getOpfsDirectory(path, true);
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function removeOpfsFile(path, fileName) {
  try {
    const directory = await getOpfsDirectory(path);
    await directory.removeEntry(fileName);
    return true;
  } catch (err) {
    if (err.name === "NotFoundError") return true; // already gone
    console.error(`[OPFS] Failed to remove ${[...path, fileName].join("/")}:`, err);
    return false;
  }
}

async function removeOpfsDirectoryIfEmpty(path) {
  // Keep the top-level folders (savegames, snapshots)
  if (path.length <= 1) return;

  try {
    const directory = await getOpfsDirectory(path);
    const entries = await readSortedEntries(directory);
    if (entries.length > 0) return;

    const parent = await getOpfsDirectory(path.slice(0, -1));
    await parent.removeEntry(path.at(-1));
    console.log(`[OPFS] Empty folder deleted: ${path.join("/")}`);
  } catch (err) {
    if (err.name !== "NotFoundError") {
      console.error(`[OPFS] Failed to clean up folder ${path.join("/")}:`, err);
    }
  }
}

function getSnapshotFileName(gameId) {
  return `${gameId}${SNAPSHOT_EXTENSION}`;
}

function renderSearchResults(listElement, results, onPick) {
  const items = results.map((game) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "w-full text-left px-3 py-2 text-[10px] bg-surface-container-lowest hover:bg-[#2a2a2a] flex justify-between gap-2";

    const name = document.createElement("span");
    name.className = "text-primary truncate";
    name.textContent = game.name;

    const key = document.createElement("span");
    key.className = "text-secondary-fixed-dim shrink-0";
    key.textContent = game.key;

    button.append(name, key);
    button.onclick = () => onPick(game.key);

    const item = document.createElement("li");
    item.append(button);
    return item;
  });

  listElement.replaceChildren(...items);
}

function buildNewGameModal(defaultKey) {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="bg-surface-container-low border border-primary/40 shadow-[0_0_30px_rgba(87,217,217,0.15)] w-full max-w-md max-h-full overflow-y-auto p-6">
      <div class="flex items-center gap-2 mb-4">
        <span class="material-symbols-outlined text-primary text-sm">terminal</span>
        <h2 class="text-primary font-bold uppercase text-sm tracking-widest phosphor-glow">New Game Detected</h2>
      </div>
      <p class="text-[10px] text-secondary-fixed-dim mb-4 leading-relaxed">
        No configuration was found for this file. Search an existing game to reuse its
        configuration, or enter a new key to register it.
        Only letters, numbers, "-" and "_" are allowed in the key.
      </p>
      <div class="space-y-2 mb-2">
        <label class="block text-[10px] text-secondary font-bold uppercase">Search existing games</label>
        <input
          id="new-game-search-input"
          type="text"
          placeholder="Name or key"
          autocomplete="off"
          class="w-full bg-surface-container-lowest border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors"
        />
      </div>
      <ul id="new-game-search-results" class="mb-4 space-y-1"></ul>
      <div class="space-y-2 mb-2">
        <label class="block text-[10px] text-secondary font-bold uppercase">Game Key</label>
        <input
          id="new-game-key-input"
          type="text"
          autocomplete="off"
          class="w-full bg-surface-container-lowest border-b-2 border-outline focus:border-primary px-3 py-2 text-primary font-mono outline-none transition-colors"
          value="${escapeHtml(defaultKey)}"
        />
      </div>
      <p id="new-game-key-status" class="text-[10px] min-h-[1rem]"></p>
      <p id="new-game-key-error" class="text-[10px] text-error mb-4 min-h-[1rem]"></p>
      <div class="flex gap-3">
        <button id="new-game-key-confirm" class="flex-1 bg-[#57d9d9] text-[#003737] py-3 font-black uppercase text-xs tracking-widest hover:brightness-110 active:scale-95 transition-all">
          CONFIRM
        </button>
        <button id="new-game-key-cancel" class="flex-1 bg-surface-container-highest text-on-surface border border-outline-variant/30 py-3 font-bold uppercase text-xs hover:bg-error hover:text-on-error transition-colors">
          CANCEL
        </button>
      </div>
    </div>
  `;

  return overlay;
}

// Resolves with the chosen key, or null if the user cancels.
function showNewGameKeyModal(defaultKey, games) {
  return new Promise((resolve) => {
    const overlay = buildNewGameModal(defaultKey);
    document.body.append(overlay);

    const searchInput = overlay.querySelector("#new-game-search-input");
    const resultsList = overlay.querySelector("#new-game-search-results");
    const keyInput = overlay.querySelector("#new-game-key-input");
    const statusLabel = overlay.querySelector("#new-game-key-status");
    const errorLabel = overlay.querySelector("#new-game-key-error");

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const updateStatus = () => {
      const { isExisting, message } = describeKey(games, keyInput.value);
      statusLabel.textContent = message;
      statusLabel.classList.toggle("text-primary", isExisting);
      statusLabel.classList.toggle("text-secondary-fixed-dim", !isExisting);
    };

    const pickGame = (key) => {
      keyInput.value = key;
      searchInput.value = "";
      resultsList.replaceChildren();
      errorLabel.textContent = "";
      updateStatus();
    };

    searchInput.addEventListener("input", () => {
      renderSearchResults(resultsList, searchGames(games, searchInput.value), pickGame);
    });

    keyInput.addEventListener("input", () => {
      // Remove invalid characters as the user types
      keyInput.value = keyInput.value.replace(GAME_KEY_INVALID_CHARS, "");
      errorLabel.textContent = "";
      updateStatus();
    });

    overlay.querySelector("#new-game-key-confirm").onclick = () => {
      const key = keyInput.value.trim();
      if (!GAME_KEY_PATTERN.test(key)) {
        errorLabel.textContent = "Invalid key. Use only letters, numbers, - or _.";
        keyInput.focus();
        return;
      }
      close(key);
    };

    overlay.querySelector("#new-game-key-cancel").onclick = () => close(null);

    updateStatus();
    searchInput.focus();
  });
}

function showConfirmModal({ title, message, confirmLabel = "CONFIRM" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4";

    overlay.innerHTML = `
      <div class="bg-surface-container-low border border-error/40 shadow-[0_0_30px_rgba(255,180,171,0.15)] w-full max-w-md p-6">
        <div class="flex items-center gap-2 mb-4">
          <span class="material-symbols-outlined text-error text-sm">warning</span>
          <h2 id="confirm-modal-title" class="text-error font-bold uppercase text-sm tracking-widest"></h2>
        </div>
        <p id="confirm-modal-message" class="text-[10px] text-secondary-fixed-dim mb-6 leading-relaxed break-all"></p>
        <div class="flex gap-3">
          <button id="confirm-modal-confirm" class="flex-1 bg-error text-on-error py-3 font-black uppercase text-xs tracking-widest hover:brightness-110 active:scale-95 transition-all"></button>
          <button id="confirm-modal-cancel" class="flex-1 bg-surface-container-highest text-on-surface border border-outline-variant/30 py-3 font-bold uppercase text-xs hover:bg-surface-variant transition-colors">CANCEL</button>
        </div>
      </div>
    `;

    // textContent (not innerHTML): the message may contain file names
    overlay.querySelector("#confirm-modal-title").textContent = title;
    overlay.querySelector("#confirm-modal-message").textContent = message;
    const confirmButton = overlay.querySelector("#confirm-modal-confirm");
    const cancelButton = overlay.querySelector("#confirm-modal-cancel");
    confirmButton.textContent = confirmLabel;

    const onKeyDown = (event) => {
      if (event.key === "Escape") close(false);
    };

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    };

    confirmButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    cancelButton.focus();
  });
}

// Makes sure there is a configuration entry for the key (see install-flow.js).
// snapshotSaves: new entries save the whole emulator state, which is how a game
// installed from a disc keeps its installed files.
async function registerGame(key, { snapshotSaves = false } = {}) {
  if (window.gamesData[key]) return;

  const knownConfig = window.defaultGamesData?.[key];
  const config = knownConfig
    ? structuredClone(knownConfig)
    : { ...structuredClone(window.gamesData.generic), name: key, opfsSaveFilePath: key };

  if (!knownConfig && snapshotSaves) {
    config.jsDos = { ...config.jsDos, saveMode: SAVE_MODE_PERSIST };
  }

  window.gamesData[key] = config;
  await saveGamesConfigToOPFS();
}

// Returns the key the game will be installed with, or null if the user cancelled.
async function resolveGameKey(fileName) {
  const fileKey = stripExtension(fileName);
  if (window.gamesData[fileKey]) return fileKey;

  return showNewGameKeyModal(suggestKey(fileName), getKnownGames());
}

async function installGame(event) {
  const files = [...event.target.files];
  if (files.length === 0) return;

  try {
    await installFiles(files);
  } catch (err) {
    console.error("Failed to install the game:", err);
    alert(describeInstallError(err));
  }

  // Lets the user pick the same files again
  event.target.value = "";
  loadList();
  renderOpfsTree();
}

function setupTopBarMenu() {
  const exitGameButtons = document.querySelectorAll(".exit-game-button");
  const saveGameButtons = document.querySelectorAll(".save-game-button");

  exitGameButtons.forEach((btn) => {
    btn.style.display = "none";
    btn.addEventListener("click", () => {
      if (!window?.gamePlayer) return;
      if (!isGameRuning) return;

      const container = document.getElementById("game-panel");
      const dashboardPanel = document.getElementById("dashboard-panel");
      const detailPanel = document.getElementById("detail-panel");

      stopGame();

      container.innerHTML = "";
      container.style.display = "none";
      dashboardPanel.style.display = "";
      detailPanel.style.display = "";
      loadList();
    });
  });

  saveGameButtons.forEach((btn) => {
    btn.style.display = "none";
    btn.addEventListener("click", async () => {
      if (!window?.gamePlayer || !isGameRuning) return;
      if (!activeCi || !gameRuningId) {
        alert("The game is not ready yet.");
        return;
      }

      const gameConfig = getGameConfigByGameId(gameRuningId);

      try {
        await getSaveStrategy(gameConfig).save(activeCi, gameRuningId, gameConfig);
        await renderOpfsTree();
        alert("Game saved.");
      } catch (e) {
        alert("Failed to save: " + e.message);
      }
    });
  });
}

function displayTopBarMenu() {
  document.querySelectorAll(".exit-game-button").forEach((btn) => {
    btn.style.display = isGameRuning ? "" : "none";
  });
  document.querySelectorAll(".save-game-button").forEach((btn) => {
    btn.style.display = isGameRuning ? "" : "none";
  });
}

async function startGame({ container, url, jsDosConfig, initFs }) {
  try {
    window.gamePlayer = Dos(container, {
      url,
      autoStart: true,
      mouseCapture: jsDosConfig?.mouseCapture || false,
      ...(initFs ? { initFs } : {}),
      fsChanges: {
        local: false,
      },
      onEvent: (event, ci) => {
        if (event === "ci-ready") {
          activeCi = ci;
          clearLaunchMark();
        }
      },
    });
  } catch (err) {
    console.error("Failed to start the game in js-dos:", err);
    alert("Could not start the emulator.");
    return;
  }

  isGameRuning = true;
  displayTopBarMenu();
}

function stopGame() {
  window.gamePlayer.stop();
  window.gamePlayer = null;
  activeCi = null;

  if (bundleUrl) {
    URL.revokeObjectURL(bundleUrl);
    bundleUrl = null;
  }

  isGameRuning = false;
  displayTopBarMenu();
}

function openMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobile-sidebar-overlay");
  sidebar.classList.remove("-translate-x-full");
  sidebar.classList.add("translate-x-0");
  overlay.classList.remove("hidden");
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobile-sidebar-overlay");
  sidebar.classList.remove("translate-x-0");
  sidebar.classList.add("-translate-x-full");
  overlay.classList.add("hidden");
}

function setupMobileSidebar() {
  const menuButton = document.getElementById("mobile-menu-button");
  const overlay = document.getElementById("mobile-sidebar-overlay");

  menuButton.addEventListener("click", openMobileSidebar);
  overlay.addEventListener("click", closeMobileSidebar);
}

async function renderOpfsFolderTree(folderName, containerId, emptyMessage) {
  const treeContainer = document.getElementById(containerId);
  if (!treeContainer) return;
  treeContainer.innerHTML = "";

  try {
    const folderHandle = await getOpfsDirectory([folderName]);
    const treeEl = await buildOpfsTreeNode(folderHandle, [folderName]);
    treeContainer.append(treeEl);
  } catch (err) {
    if (err.name === "NotFoundError") {
      treeContainer.innerHTML = `<p class="text-secondary-fixed-dim px-2 py-1 italic">${emptyMessage}</p>`;
    } else {
      console.error(`[OPFS] Error building ${folderName} tree:`, err);
    }
  }
}

async function renderOpfsTree() {
  await renderOpfsFolderTree(SAVEGAMES, "opfs-tree", "No savegames yet.");
  await renderOpfsFolderTree(SNAPSHOTS, "snapshots-tree", "No snapshots yet.");
}

async function readSortedEntries(directoryHandle) {
  const entries = [];
  for await (const entry of directoryHandle.entries()) {
    entries.push(entry);
  }
  return entries.sort(([nameA, handleA], [nameB, handleB]) => {
    if (handleA.kind !== handleB.kind) return handleA.kind === "directory" ? -1 : 1;
    return nameA.localeCompare(nameB);
  });
}

function buildFolderNode(name, handle, path) {
  const wrapper = document.createElement("div");

  const row = document.createElement("div");
  row.className =
    "flex items-center gap-2 px-2 py-1.5 text-[#c7c6c6] hover:text-[#57d9d9] hover:bg-[#2a2a2a] cursor-pointer transition-none";
  row.innerHTML = `
    <span class="material-symbols-outlined text-sm folder-toggle-icon">chevron_right</span>
    <span class="material-symbols-outlined text-sm">folder</span>
    <span class="font-['Space_Grotesk'] font-medium uppercase truncate">${escapeHtml(name)}</span>
  `;

  const children = document.createElement("div");
  children.className = "hidden pl-5";

  let loaded = false;
  row.onclick = async () => {
    const icon = row.querySelector(".folder-toggle-icon");
    const willOpen = children.classList.contains("hidden");

    if (willOpen && !loaded) {
      children.append(await buildOpfsTreeNode(handle, [...path, name]));
      loaded = true;
    }
    children.classList.toggle("hidden", !willOpen);
    icon.textContent = willOpen ? "expand_more" : "chevron_right";
  };

  wrapper.append(row, children);
  return wrapper;
}

async function buildFileNode(name, handle, path) {
  const { size } = await handle.getFile();

  const row = document.createElement("div");
  row.className =
    "flex items-center gap-2 pl-7 pr-1 text-secondary-fixed-dim hover:bg-[#2a2a2a]";
  row.innerHTML = `
    <span class="material-symbols-outlined text-sm">description</span>
    <span class="font-['Space_Grotesk'] truncate">${escapeHtml(name)}</span>
    <span class="shrink-0 opacity-70">(${formatFileSize(size)})</span>
    <button class="ml-auto material-symbols-outlined text-sm text-[#c7c6c6] hover:text-error p-1.5" title="Delete file">delete</button>
  `;

  row.querySelector("button").onclick = () => deleteSavedFile(path, name);
  return row;
}

function buildEmptyNode() {
  const row = document.createElement("div");
  row.className = "px-2 py-1 text-secondary-fixed-dim italic";
  row.textContent = "(empty)";
  return row;
}

async function buildOpfsTreeNode(directoryHandle, path) {
  const list = document.createElement("div");
  list.className = "space-y-1";

  const entries = await readSortedEntries(directoryHandle);
  const nodes = await Promise.all(
    entries.map(([name, handle]) =>
      handle.kind === "directory"
        ? buildFolderNode(name, handle, path)
        : buildFileNode(name, handle, path),
    ),
  );
  list.append(...nodes);

  if (entries.length === 0) list.append(buildEmptyNode());
  return list;
}

async function bootstrap() {
  await initGamesConfig();
  await checkPreviousLaunch();
  await loadList();
  await renderOpfsTree();

  const installBtn = document.getElementById("install-game-button");
  const installBtnMobile = document.getElementById(
    "install-game-button-mobile",
  );
  const inputFile = document.getElementById("rom-input");

  const versionInfo = document.getElementById("version_info");
  versionInfo.innerHTML = `v${VERSION}`;

  installBtn.addEventListener("click", () => {
    inputFile.click();
  });

  installBtnMobile.addEventListener("click", () => {
    inputFile.click();
  });

  inputFile.addEventListener("change", installGame);
  setupTopBarMenu();
  setupMobileSidebar();
}

const DISCS = "discs";
const DISC_ISO_NAME = "cd.iso";
const DISC_CUE_NAME = "cd.cue";
const DISC_DRIVE_LETTER = "d";
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
// Starting values for the "may not run on this device" warning: tune them after testing.
const DISC_WARNING_BYTES = { mobile: 300 * MIB, desktop: GIB };
// Share of the free quota an installation may use (the quota is only an estimate)
const STORAGE_SAFETY_MARGIN = 0.9;
// true: hand the disc to js-dos with initFs (less memory). false: put it inside the bundle ZIP.
const DISC_VIA_INIT_FS = true;
const LAUNCH_FLAG_KEY = "launching-game";
const PROGRESS_THROTTLE_MS = 100;

function getExtension(fileName) {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

function baseName(path) {
  return path.split(/[\\/]/).pop();
}

// "Game (Track 1).cue" -> "Game-Track-1"
function suggestKey(fileName) {
  return stripExtension(fileName)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Matches lines like:  FILE "Game (Track 1).bin" BINARY
const CUE_FILE_LINE = /^([ \t]*)FILE[ \t]+(?:"([^"]+)"|(\S+))[ \t]+(\S+)[ \t]*$/gim;

function parseCueFileNames(cueText) {
  const names = [];
  for (const match of cueText.matchAll(CUE_FILE_LINE)) {
    const name = baseName(match[2] ?? match[3]);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// nameMap: lowercase original file name -> normalized file name
function rewriteCue(cueText, nameMap) {
  return cueText.replace(CUE_FILE_LINE, (line, indent, quoted, bare, type) => {
    const normalized = nameMap.get(baseName(quoted ?? bare).toLowerCase());
    return normalized ? `${indent}FILE "${normalized}" ${type}` : line;
  });
}

function validateSelection({ files, zips, isos, cues }) {
  if (zips.length > 1) return "Select only one .zip file.";
  if (isos.length > 1) return "Select only one .iso file.";
  if (cues.length > 1) return "Select only one .cue file.";
  if (isos.length && cues.length) {
    return "Select either an .iso or a .cue with its track files, not both.";
  }

  const hasLooseTracks =
    !cues.length && files.some((file) => !["zip", "iso"].includes(getExtension(file.name)));
  if (hasLooseTracks) {
    return "Track files need their .cue file. Select the .cue together with its tracks.";
  }
  if (!zips.length && !isos.length && !cues.length) {
    return "Select a .zip, an .iso, or a .cue with its track files.";
  }
  return null;
}

function buildCueDisc(cueFile, cueText, files) {
  const referenced = parseCueFileNames(cueText);
  if (referenced.length === 0) {
    return { error: "The .cue file does not reference any track file." };
  }

  const candidates = files.filter((file) => file !== cueFile);
  const tracks = [];
  const missing = [];
  for (const name of referenced) {
    const file = candidates.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (file) tracks.push({ file, name });
    else missing.push(name);
  }

  if (missing.length > 0) {
    return { error: `Missing files referenced by the .cue: ${missing.join(", ")}` };
  }
  return { type: "cue", cue: cueFile, cueText, tracks };
}

// Returns { error } or { zip, disc, primaryName }.
// A game can have a .zip, a disc (.iso, or .cue with its tracks), or both.
function planInstall(files, cueText) {
  const withExtension = (extension) =>
    files.filter((file) => getExtension(file.name) === extension);
  const zips = withExtension("zip");
  const isos = withExtension("iso");
  const cues = withExtension("cue");

  const error = validateSelection({ files, zips, isos, cues });
  if (error) return { error };

  let disc = null;
  if (isos.length) disc = { type: "iso", image: isos[0] };
  if (cues.length) disc = buildCueDisc(cues[0], cueText, files);
  if (disc?.error) return { error: disc.error };

  const primary = zips[0] ?? isos[0] ?? cues[0];
  return { zip: zips[0] ?? null, disc, primaryName: primary.name };
}

async function readInstallPlan(files) {
  const cueFile = files.find((file) => getExtension(file.name) === "cue");
  const cueText = cueFile ? (await cueFile.text()).replace(/^\uFEFF/, "") : null;
  return planInstall(files, cueText);
}

// Each item is { path, name, file } or { path, name, text }.
// Disc files get predictable names (cd.iso, cd.cue, track01.bin...), and the .cue is rewritten to match.
function buildInstallItems(plan, key) {
  const items = [];
  if (plan.zip) items.push({ path: [], name: `${key}.zip`, file: plan.zip });

  const discPath = [DISCS, key];
  if (plan.disc?.type === "iso") {
    items.push({ path: discPath, name: DISC_ISO_NAME, file: plan.disc.image });
  }

  if (plan.disc?.type === "cue") {
    const nameMap = new Map();
    plan.disc.tracks.forEach(({ file, name }, index) => {
      const number = String(index + 1).padStart(2, "0");
      const normalized = `track${number}.${getExtension(file.name) || "bin"}`;
      nameMap.set(name.toLowerCase(), normalized);
      items.push({ path: discPath, name: normalized, file });
    });
    const text = rewriteCue(plan.disc.cueText, nameMap);
    items.push({ path: discPath, name: DISC_CUE_NAME, text });
  }

  return items;
}

function getItemSize(item) {
  return item.file ? item.file.size : new TextEncoder().encode(item.text).length;
}

function getTotalSize(items) {
  return items.reduce((total, item) => total + getItemSize(item), 0);
}

function getDiscBytes(items) {
  return getTotalSize(items.filter((item) => item.path[0] === DISCS));
}

// null when the browser does not report it
async function getAvailableStorage() {
  if (!navigator.storage?.estimate) return null;
  const { quota, usage = 0 } = await navigator.storage.estimate();
  return quota === undefined ? null : Math.max(0, quota - usage);
}

// Above this disc size the game may not run (the emulator keeps the disc in memory).
function getDiscWarningBytes() {
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  const base = isMobile ? DISC_WARNING_BYTES.mobile : DISC_WARNING_BYTES.desktop;
  const memoryGiB = navigator.deviceMemory; // Chromium only, rounded
  return memoryGiB ? Math.min(base, memoryGiB * GIB * 0.1) : base;
}

// level: "ok", "warn" (ask the user) or "block" (does not fit).
// availableBytes is null when the browser does not report the free space.
function checkInstallSize({ totalBytes, discBytes, availableBytes, warningBytes }) {
  if (availableBytes !== null && totalBytes > availableBytes * STORAGE_SAFETY_MARGIN) {
    return {
      level: "block",
      message: `Not enough storage: ${formatFileSize(totalBytes)} needed, ${formatFileSize(availableBytes)} available.`,
    };
  }

  if (discBytes > warningBytes) {
    return {
      level: "warn",
      message: `This disc image (${formatFileSize(discBytes)}) is large for this device and the game may fail to run. Install it anyway?`,
    };
  }

  return { level: "ok", message: "" };
}

async function confirmInstallSize(items) {
  const check = checkInstallSize({
    totalBytes: getTotalSize(items),
    discBytes: getDiscBytes(items),
    availableBytes: await getAvailableStorage(),
    warningBytes: getDiscWarningBytes(),
  });

  if (check.level === "block") {
    alert(check.message);
    return false;
  }
  if (check.level === "warn") {
    return showConfirmModal({
      title: "Large disc image",
      message: check.message,
      confirmLabel: "INSTALL",
    });
  }
  return true;
}

async function opfsEntryExists(path, name) {
  try {
    const directory = await getOpfsDirectory(path);
    for await (const [entryName] of directory.entries()) {
      if (entryName === name) return true;
    }
    return false;
  } catch (err) {
    if (err.name === "NotFoundError") return false;
    throw err;
  }
}

async function removeOpfsDirectory(path, name) {
  try {
    const parent = await getOpfsDirectory(path);
    await parent.removeEntry(name, { recursive: true });
  } catch (err) {
    if (err.name !== "NotFoundError") {
      console.error(`[OPFS] Failed to remove folder ${[...path, name].join("/")}:`, err);
    }
  }
}

async function getInstalledMedia(gameId) {
  return {
    zip: await opfsEntryExists([], `${gameId}.zip`),
    disc: await opfsEntryExists([DISCS], gameId),
  };
}

// Copies a file in chunks, so the whole file is never held in memory.
async function copyFileToOpfs(file, path, name, { signal, onBytes }) {
  const directory = await getOpfsDirectory(path, true);
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();

  const counter = new TransformStream({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });

  await file.stream().pipeThrough(counter).pipeTo(writable, { signal });
}

async function requestPersistentStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported: the installation continues without persistent storage
  }
}

function showProgressModal(title) {
  const controller = new AbortController();
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="bg-surface-container-low border border-primary/40 shadow-[0_0_30px_rgba(87,217,217,0.15)] w-full max-w-md p-6">
      <h2 id="progress-title" class="text-primary font-bold uppercase text-sm tracking-widest phosphor-glow mb-4"></h2>
      <p id="progress-label" class="text-[10px] text-secondary-fixed-dim mb-3 break-all min-h-[1rem]"></p>
      <div class="h-2 bg-surface-container-highest mb-2">
        <div id="progress-bar" class="h-2 bg-primary" style="width: 0%"></div>
      </div>
      <p id="progress-percent" class="text-[10px] text-secondary mb-6">0%</p>
      <button id="progress-cancel" class="w-full bg-surface-container-highest text-on-surface border border-outline-variant/30 py-3 font-bold uppercase text-xs hover:bg-error hover:text-on-error transition-colors">
        CANCEL
      </button>
    </div>
  `;

  // textContent (not innerHTML): the title and labels contain file names
  overlay.querySelector("#progress-title").textContent = title;
  const label = overlay.querySelector("#progress-label");
  const bar = overlay.querySelector("#progress-bar");
  const percent = overlay.querySelector("#progress-percent");

  const cancelButton = overlay.querySelector("#progress-cancel");
  cancelButton.onclick = () => {
    cancelButton.disabled = true;
    cancelButton.textContent = "CANCELLING...";
    controller.abort();
  };

  document.body.append(overlay);

  return {
    signal: controller.signal,
    update(text, fraction) {
      const value = Math.min(100, Math.round(fraction * 100));
      label.textContent = text;
      bar.style.width = `${value}%`;
      percent.textContent = `${value}%`;
    },
    close: () => overlay.remove(),
  };
}

// Returns track(bytes, label), which updates the progress at most every PROGRESS_THROTTLE_MS.
function createProgressTracker(items, progress) {
  const totalBytes = getTotalSize(items) || 1;
  let copiedBytes = 0;
  let lastUpdate = 0;

  return (bytes, label) => {
    copiedBytes += bytes;
    const now = performance.now();
    const isLast = copiedBytes >= totalBytes;
    if (!isLast && now - lastUpdate < PROGRESS_THROTTLE_MS) return;

    lastUpdate = now;
    progress.update(label, copiedBytes / totalBytes);
  };
}

async function copyInstallItems(items, progress) {
  const track = createProgressTracker(items, progress);

  for (const item of items) {
    if (item.file) {
      await copyFileToOpfs(item.file, item.path, item.name, {
        signal: progress.signal,
        onBytes: (bytes) => track(bytes, item.name),
      });
    } else {
      await writeOpfsFile(item.path, item.name, item.text);
      track(getItemSize(item), item.name);
    }
  }
}

async function confirmReplacement(key, plan, installed) {
  const replaced = [];
  if (plan.zip && installed.zip) replaced.push("game files");
  if (plan.disc && installed.disc) replaced.push("disc image");
  if (replaced.length === 0) return true;

  return showConfirmModal({
    title: "Replace files",
    message: `"${key}" is already installed. Its ${replaced.join(" and ")} will be replaced.`,
    confirmLabel: "REPLACE",
  });
}

async function removeFailedInstall(key, plan, installed) {
  if (plan.disc) await removeOpfsDirectory([DISCS], key);
  if (plan.zip && !installed.zip) await removeOpfsFile([], `${key}.zip`);
}

async function copyAndRegister(key, plan, items, installed) {
  await requestPersistentStorage();

  // A new disc replaces the previous one completely, so no old tracks are left behind
  if (plan.disc) await removeOpfsDirectory([DISCS], key);

  const progress = showProgressModal(`Installing ${key}`);
  let done = false;
  try {
    await copyInstallItems(items, progress);
    await registerGame(key, { snapshotSaves: !plan.zip });
    await saveDiscMount(key, getPlanImageName(plan));
    done = true;
  } catch (err) {
    await removeFailedInstall(key, plan, installed);
    if (err.name !== "AbortError") throw err; // AbortError: cancelled by the user
  } finally {
    progress.close();
  }

  if (done) alert(`${key} installed.`);
}

async function installFiles(files) {
  const selection = await resolveArchives(files);
  if (!selection) return;

  const plan = await readInstallPlan(selection.files);
  if (plan.error) {
    alert(plan.error);
    return;
  }

  // A disc that came out of a .zip is named after the .zip, not after the .cue inside it
  const keySource = plan.zip ? plan.primaryName : (selection.archiveName ?? plan.primaryName);
  const key = await resolveGameKey(keySource);
  if (!key) return;

  const items = buildInstallItems(plan, key);
  if (!(await confirmInstallSize(items))) return;

  const installed = await getInstalledMedia(key);
  if (!(await confirmReplacement(key, plan, installed))) return;

  await copyAndRegister(key, plan, items, installed);
}

function describeInstallError(err) {
  return err.name === "QuotaExceededError"
    ? "Not enough storage to finish the installation."
    : "An error occurred while installing the game.";
}

async function listDiscGameIds() {
  try {
    const directory = await getOpfsDirectory([DISCS]);
    const ids = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "directory") ids.push(name);
    }
    return ids;
  } catch (err) {
    if (err.name === "NotFoundError") return [];
    throw err;
  }
}

// A game exists when it has a .zip, a disc, or both.
async function listInstalledGames() {
  const games = new Map();
  const upsert = (gameId) => {
    if (!games.has(gameId)) {
      games.set(gameId, { gameId, zipHandle: null, zipName: null, hasDisc: false });
    }
    return games.get(gameId);
  };

  const root = await getOpfsDirectory();
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "file" && name.endsWith(".zip")) {
      const game = upsert(getGameIdByFilename(name));
      game.zipHandle = handle;
      game.zipName = name;
    }
  }

  for (const gameId of await listDiscGameIds()) {
    upsert(gameId).hasDisc = true;
  }

  return [...games.values()];
}

function buildGameCard(game) {
  const config = getGameConfigByGameId(game.gameId);
  const company = `${config?.company || "-"}${game.hasDisc ? " \u00b7 CD" : ""}`;

  const card = document.createElement("div");
  card.className =
    "group cursor-pointer bg-surface-container-low border border-outline-variant/20 hover:border-primary/50 transition-all p-3";

  card.innerHTML = `<div class="relative bg-surface-container-high aspect-square mb-4 overflow-hidden border border-primary/20">
      <img
        class="w-full h-full object-cover grayscale contrast-125 brightness-75 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-300"
        data-alt="Retro 90s FPS game screenshot with dark corridors"
        src="${escapeHtml(config?.wallscroll || "./assets/generic1.png")}"
      />
      <div class="absolute inset-0 bg-primary/10 mix-blend-overlay"></div>
    </div>
    <div class="flex justify-between items-start">
      <div>
        <h3 class="text-on-surface font-bold text-sm group-hover:text-primary">${escapeHtml(config.name)}</h3>
        <p class="text-secondary text-[10px] mt-1 uppercase">${escapeHtml(company)}</p>
      </div>
      <span class="text-primary font-bold text-[10px] tracking-widest"><strike>[INFO]</strike></span>
    </div>`;

  card.onclick = () => loadGameDetails(game.zipHandle, game.zipName, game.gameId);
  return card;
}

// Puts the mount line in the right place: after "mount c .", else after [autoexec], else in a new section.
function insertMountLine(dosboxConf, mountLine) {
  const driveMount = /^[ \t]*mount[ \t]+c\b.*$/im;
  if (driveMount.test(dosboxConf)) {
    return dosboxConf.replace(driveMount, (line) => `${line}\n${mountLine}`);
  }

  const autoexecHeader = /^\[autoexec\][ \t]*$/im;
  if (autoexecHeader.test(dosboxConf)) {
    return dosboxConf.replace(autoexecHeader, (header) => `${header}\n${mountLine}`);
  }

  return `${dosboxConf}\n[autoexec]\n${mountLine}\n`;
}

// Makes sure the dosbox.conf mounts the disc as D:.
// - no mount for D: -> "imgmount d <image> -t iso" is added after "mount c ."
// - a line generated before (cd.iso or cd.cue) -> it is updated to the current image
// - a mount written by hand -> it is left alone
function withDiscMount(dosboxConf, imageName) {
  if (!imageName) return dosboxConf;

  const drive = DISC_DRIVE_LETTER;
  const generatedMount = new RegExp(
    `^([ \\t]*imgmount[ \\t]+${drive}[ \\t]+)cd\\.(?:iso|cue)\\b`,
    "im",
  );
  if (generatedMount.test(dosboxConf)) {
    return dosboxConf.replace(generatedMount, `$1${imageName}`);
  }

  const customMount = new RegExp(`^[ \\t]*imgmount[ \\t]+${drive}\\b`, "im");
  if (customMount.test(dosboxConf)) return dosboxConf;

  return insertMountLine(dosboxConf, `imgmount ${drive} ${imageName} -t iso`);
}

// Image name a plan installs: "cd.iso", "cd.cue", or null when the game has no disc.
function getPlanImageName(plan) {
  if (!plan.disc) return null;
  return plan.disc.type === "cue" ? DISC_CUE_NAME : DISC_ISO_NAME;
}

// Saves the mount line in the game's config, so it shows up (and can be edited) in Setup.
async function saveDiscMount(gameId, imageName) {
  const config = window.gamesData[gameId];
  if (!config || !imageName) return;

  const updated = withDiscMount(config.dosboxConfig ?? "", imageName);
  if (updated === config.dosboxConfig) return;

  config.dosboxConfig = updated;
  await saveGamesConfigToOPFS();
}

async function readDiscFiles(gameId) {
  try {
    const directory = await getOpfsDirectory([DISCS, gameId]);
    const files = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "file") files.push({ name, file: await handle.getFile() });
    }
    return files;
  } catch (err) {
    if (err.name === "NotFoundError") return [];
    throw err;
  }
}

function getDiscImageName(discFiles) {
  const names = discFiles.map(({ name }) => name);
  if (names.includes(DISC_CUE_NAME)) return DISC_CUE_NAME;
  return names.includes(DISC_ISO_NAME) ? DISC_ISO_NAME : null;
}

// Returns null when the game has no disc, or { image, entries } ready for the emulator.
async function prepareDisc(gameId) {
  const discFiles = await readDiscFiles(gameId);
  const image = getDiscImageName(discFiles);
  if (!image) return null;

  const entries = [];
  for (const { name, file } of discFiles) {
    entries.push({ path: name, contents: new Uint8Array(await file.arrayBuffer()) });
  }
  return { image, entries };
}

// Returns the initFs option for js-dos, or undefined when the disc goes inside the ZIP.
function attachDisc(zip, disc) {
  if (!disc) return undefined;
  if (DISC_VIA_INIT_FS) return disc.entries;

  disc.entries.forEach(({ path, contents }) => zip.file(path, contents, { compression: "STORE" }));
  return undefined;
}

// A game can be only a disc: then the bundle starts empty and only gets the config.
async function openGameZip(fileHandle) {
  if (!fileHandle) return new JSZip();
  const file = await fileHandle.getFile();
  return JSZip.loadAsync(await file.arrayBuffer());
}

// Launch marker: if the page dies while loading (typically out of memory), the next start says so.
function markLaunchStarted(gameId) {
  try {
    localStorage.setItem(LAUNCH_FLAG_KEY, gameId);
  } catch {
    // Storage unavailable: the check is simply skipped
  }
}

function clearLaunchMark() {
  try {
    localStorage.removeItem(LAUNCH_FLAG_KEY);
  } catch {
    // Storage unavailable: nothing to clear
  }
}

function checkPreviousLaunch() {
  let gameId = null;
  try {
    gameId = localStorage.getItem(LAUNCH_FLAG_KEY);
  } catch {
    // Nothing to do
  }
  if (!gameId) return;

  clearLaunchMark();
  const name = getGameConfigByGameId(gameId)?.name ?? gameId;
  alert(
    `The last launch of "${name}" did not finish. If this keeps happening, the game may be too large for this device.`,
  );
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_MAX_COMMENT_SIZE = 0xffff;
const ZIP_LOCAL_HEADER_SIZE = 30;
const ZIP_CENTRAL_HEADER_SIZE = 46;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const DISC_ARCHIVE_EXTENSIONS = ["cue", "iso", "bin", "wav", "mp3", "ogg", "flac"];

function findZipEndRecord(view) {
  for (let offset = view.byteLength - ZIP_EOCD_SIZE; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error("Not a valid .zip file.");
}

function parseZipDirectory(view, entryCount) {
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("The .zip directory is corrupted.");
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameBytes = new Uint8Array(
      view.buffer,
      view.byteOffset + offset + ZIP_CENTRAL_HEADER_SIZE,
      nameLength,
    );
    const name = decoder.decode(nameBytes);

    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });

    offset += ZIP_CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntries(file) {
  const tailSize = Math.min(file.size, ZIP_EOCD_SIZE + ZIP_MAX_COMMENT_SIZE);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  const end = findZipEndRecord(tail);

  const entryCount = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("Zip64 archives are not supported.");
  }

  const directoryEnd = directoryOffset + directorySize;
  const directory = await file.slice(directoryOffset, directoryEnd).arrayBuffer();
  return parseZipDirectory(new DataView(directory), entryCount);
}

// The size recorded in the directory must match what comes out of the stream
function createSizeChecker(entry) {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      if (total !== entry.size) {
        throw new Error(`"${entry.name}" is corrupted or truncated.`);
      }
    },
  });
}

async function openZipEntryStream(file, entry) {
  if (entry.flags & 1) throw new Error("Encrypted .zip files are not supported.");
  if (![ZIP_STORED, ZIP_DEFLATED].includes(entry.method)) {
    throw new Error(`Unsupported compression method (${entry.method}) in "${entry.name}".`);
  }

  // The local header has its own name/extra lengths, which can differ from the directory's
  const headerEnd = entry.localOffset + ZIP_LOCAL_HEADER_SIZE;
  const header = new DataView(await file.slice(entry.localOffset, headerEnd).arrayBuffer());
  if (header.getUint32(0, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error("The .zip file is corrupted.");
  }

  const dataStart = headerEnd + header.getUint16(26, true) + header.getUint16(28, true);
  let stream = file.slice(dataStart, dataStart + entry.compressedSize).stream();
  if (entry.method === ZIP_DEFLATED) {
    stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  return stream.pipeThrough(createSizeChecker(entry));
}

// Looks like a File for the install flow (name, size, stream, text), but reads from the .zip.
function createZipEntryFile(zipFile, entry) {
  const file = {
    name: baseName(entry.name),
    size: entry.size,
    stream() {
      let reader = null;
      return new ReadableStream({
        async pull(controller) {
          reader ??= (await openZipEntryStream(zipFile, entry)).getReader();
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel: (reason) => reader?.cancel(reason),
      });
    },
    text: () => new Response(file.stream()).text(),
  };
  return file;
}

// A disc archive has a .cue or .iso and is not a js-dos bundle. Returns the entries that make up the disc.
function selectDiscEntries(entries) {
  const files = entries.filter(
    (entry) =>
      !entry.isDirectory && !entry.name.startsWith("__MACOSX/") && !baseName(entry.name).startsWith("."),
  );

  const isBundle = files.some((entry) => entry.name.startsWith(".jsdos/"));
  const hasImage = files.some((entry) => ["cue", "iso"].includes(getExtension(entry.name)));
  if (isBundle || !hasImage) return [];

  return files.filter((entry) => DISC_ARCHIVE_EXTENSIONS.includes(getExtension(entry.name)));
}

async function findDiscFiles(zipFile) {
  try {
    const entries = selectDiscEntries(await readZipEntries(zipFile));
    return entries.map((entry) => createZipEntryFile(zipFile, entry));
  } catch (err) {
    // Not readable as a .zip (or Zip64): it is treated as a normal game bundle
    console.warn(`[ZIP] Could not inspect ${zipFile.name}:`, err.message);
    return [];
  }
}

function validateArchiveDisc(discFiles) {
  const count = (extension) =>
    discFiles.filter((file) => getExtension(file.name) === extension).length;

  if (count("cue") > 1 || count("iso") > 1 || (count("cue") > 0 && count("iso") > 0)) {
    return "The archive contains more than one disc image. Extract and install them separately.";
  }
  return null;
}

function showChoiceModal({ title, message, options }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4";

    overlay.innerHTML = `
      <div class="bg-surface-container-low border border-primary/40 shadow-[0_0_30px_rgba(87,217,217,0.15)] w-full max-w-md p-6">
        <h2 id="choice-modal-title" class="text-primary font-bold uppercase text-sm tracking-widest phosphor-glow mb-4"></h2>
        <p id="choice-modal-message" class="text-[10px] text-secondary-fixed-dim mb-6 leading-relaxed break-all"></p>
        <div id="choice-modal-options" class="flex flex-col gap-3"></div>
      </div>
    `;

    // textContent (not innerHTML): the message contains file names
    overlay.querySelector("#choice-modal-title").textContent = title;
    overlay.querySelector("#choice-modal-message").textContent = message;

    const onKeyDown = (event) => {
      if (event.key === "Escape") close(null);
    };

    const close = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const container = overlay.querySelector("#choice-modal-options");
    options.forEach(({ label, value }, index) => {
      const button = document.createElement("button");
      button.className =
        index === 0
          ? "w-full bg-[#57d9d9] text-[#003737] py-3 font-black uppercase text-xs tracking-widest hover:brightness-110 active:scale-95 transition-all"
          : "w-full bg-surface-container-high text-secondary py-3 font-bold uppercase text-xs tracking-wider border border-outline-variant/30 hover:bg-surface-variant transition-colors";
      button.textContent = label;
      button.onclick = () => close(value);
      container.append(button);
    });

    const cancelButton = document.createElement("button");
    cancelButton.className =
      "w-full bg-surface-container-highest text-on-surface border border-outline-variant/30 py-3 font-bold uppercase text-xs hover:bg-error hover:text-on-error transition-colors";
    cancelButton.textContent = "CANCEL";
    cancelButton.onclick = () => close(null);
    container.append(cancelButton);

    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay);
    cancelButton.focus();
  });
}

function askArchiveChoice(archiveName) {
  return showChoiceModal({
    title: "Disc image detected",
    message: `"${archiveName}" contains a disc image. Install it as a disc, or as game files?`,
    options: [
      { label: "INSTALL AS DISC", value: "disc" },
      { label: "INSTALL AS GAME FILES", value: "bundle" },
    ],
  });
}

// Replaces each .zip that holds a disc with the files of that disc, if the user wants it as a disc.
// Returns { files, archiveName }, or null when the user cancels or the archive is not valid.
async function resolveArchives(files) {
  const resolved = [];
  let archiveName = null;

  for (const file of files) {
    const discFiles = getExtension(file.name) === "zip" ? await findDiscFiles(file) : [];
    if (discFiles.length === 0) {
      resolved.push(file);
      continue;
    }

    const choice = await askArchiveChoice(file.name);
    if (choice === null) return null;
    if (choice === "bundle") {
      resolved.push(file);
      continue;
    }

    const problem = validateArchiveDisc(discFiles);
    if (problem) {
      alert(problem);
      return null;
    }
    resolved.push(...discFiles);
    archiveName = file.name;
  }

  return { files: resolved, archiveName };
}

bootstrap();
