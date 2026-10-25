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

const VERSION = "0.12.0"; // x-release-please-version
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
  const root = await getOpfsDirectory();
  GAME_GRID.innerHTML = "";

  for await (const [name, handle] of root.entries()) {
    if (!(handle.kind === "file" && name.endsWith(".zip"))) {
      continue;
    }
    const gameId = getGameIdByFilename(name);
    const gameConfig = getGameConfigByGameId(gameId);

    const gameCard = document.createElement("div");
    gameCard.className =
      "group cursor-pointer bg-surface-container-low border border-outline-variant/20 hover:border-primary/50 transition-all p-3";

    gameCard.innerHTML = `<div class="relative bg-surface-container-high aspect-square mb-4 overflow-hidden border border-primary/20">
                    <img
                      class="w-full h-full object-cover grayscale contrast-125 brightness-75 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-300"
                      data-alt="Retro 90s FPS game screenshot with dark corridors"
                      src="${escapeHtml(gameConfig?.wallscroll || "./assets/generic1.png")}"
                    />
                  <div class="absolute inset-0 bg-primary/10 mix-blend-overlay"></div>
                </div>
                <div class="flex justify-between items-start">
                  <div>
                    <h3 class="text-on-surface font-bold text-sm group-hover:text-primary">${escapeHtml(gameConfig.name)}
                    </h3>
                    <p class="text-secondary text-[10px] mt-1 uppercase">${escapeHtml(gameConfig?.company || "-")}</p>
                  </div>
                  <span class="text-primary font-bold text-[10px] tracking-widest"><strike>[INFO]</strike></span>
                </div>`;

    GAME_GRID.append(gameCard);

    gameCard.onclick = () => loadGameDetails(handle, name, gameId);
  }
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
  gameButtonDelete.onclick = () => deleteGame(name);
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
  container.innerHTML = "";

  // 1. Read the game file from OPFS
  const file = await fileHandle.getFile();

  // 2. Open the original ZIP in memory with JSZip
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Inject the dosbox configuration
  zip.file(".jsdos/dosbox.conf", config.dosboxConfig);

  // Restore the previous progress according to the game's save mode
  await getSaveStrategy(config).restore(zip, gameRuningId, config);

  // 3. Generate a new ZIP blob in memory
  const bundleBlob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  bundleUrl = URL.createObjectURL(bundleBlob);

  // 4. Start js-dos v8 with the generated blob URL
  await startGame({ container, url: bundleUrl, jsDosConfig: config.jsDos });
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

async function deleteGame(fileName) {
  if (!confirm(`Are you sure to delete "${fileName}"?`))
    return;

  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);

    const gameId = getGameIdByFilename(fileName);
    await removeOpfsFile([SNAPSHOTS], getSnapshotFileName(gameId));

    if (gameId !== 'generic' && window.gamesData[gameId]) {
      delete window.gamesData[gameId];
      await saveGamesConfigToOPFS();
    }
  } catch (err) {
    console.error("Failed to delete game:", err);
    alert("The game could not be deleted.");
  }
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

// Makes sure there is a configuration entry for the key:
// - already saved: it is reused as it is
// - known from games-config.js: its defaults are copied
// - unknown: a new entry is created from the generic one (filled in by hand in Setup)
async function registerGame(key) {
  if (window.gamesData[key]) return;

  const knownConfig = window.defaultGamesData?.[key];
  window.gamesData[key] = knownConfig
    ? structuredClone(knownConfig)
    : { ...structuredClone(window.gamesData.generic), name: key, opfsSaveFilePath: key };

  await saveGamesConfigToOPFS();
}

// Returns the key the game will be installed with, or null if the user cancelled.
async function resolveGameKey(file) {
  const fileKey = getGameIdByFilename(file.name);
  if (window.gamesData[fileKey]) return fileKey;

  return showNewGameKeyModal(fileKey, getKnownGames());
}

async function installGame(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const key = await resolveGameKey(file);
    if (key) {
      await registerGame(key);
      await writeOpfsFile([], `${key}.zip`, await file.arrayBuffer());
      alert(`${key}.zip installed.`);
    }
  } catch (err) {
    console.error("An error occurred while saving the ROM:", err);
    alert("An error occurred while saving the ROM.");
  }

  // Lets the user pick the same file again
  event.target.value = "";
  loadList();
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

async function startGame({ container, url, jsDosConfig }) {
  try {
    window.gamePlayer = Dos(container, {
      url,
      autoStart: true,
      mouseCapture: jsDosConfig?.mouseCapture || false,
      fsChanges: {
        local: false,
      },
      onEvent: (event, ci) => {
        if (event === "ci-ready") {
          activeCi = ci;
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

bootstrap();
