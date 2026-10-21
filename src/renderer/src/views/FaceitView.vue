<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_URL } from '../index';
import BaseButton from '../components/base/BaseButton.vue';
import BaseInput from '../components/base/BaseInput.vue';
import BaseCheckbox from '../components/base/BaseCheckbox.vue';

interface FaceitPlayer { playerId: string; nickname: string; avatar: string; steamId: string }
interface FaceitTeam { factionId: string; name: string; avatar: string; players: FaceitPlayer[] }
interface FaceitMatch {
  matchId: string; competition: string; bestOf: number; status: string;
  source: 'api' | 'public'; teams: [FaceitTeam, FaceitTeam];
}
interface ImportResult {
  teamsCreated: number; teamsUpdated: number; playersCreated: number; playersUpdated: number; warnings: string[];
}

const input = ref('');
const setCurrent = ref(true);
const match = ref<FaceitMatch | null>(null);
const result = ref<ImportResult | null>(null);
const error = ref('');
const isLoading = ref(false);
const isImporting = ref(false);

// API settings
const apiKey = ref('');
const apiKeySet = ref(false);
const apiKeyHint = ref('');
const settingsOpen = ref(false);
const savingKey = ref(false);

const request = async (path: string, method: string, body?: unknown) => {
  const res = await fetch(`${API_URL}/faceit${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler (HTTP ${res.status})`);
  return data;
};

const loadSettings = async () => {
  try {
    const s = await request('/settings', 'GET');
    apiKeySet.value = s.apiKeySet;
    apiKeyHint.value = s.apiKeyHint;
    if (!s.apiKeySet) settingsOpen.value = true;
  } catch { /* ignore */ }
};

const saveKey = async () => {
  savingKey.value = true;
  try {
    const s = await request('/settings', 'PUT', { apiKey: apiKey.value });
    apiKeySet.value = s.apiKeySet;
    apiKeyHint.value = s.apiKeyHint;
    apiKey.value = '';
  } catch (e: any) {
    error.value = e.message;
  } finally {
    savingKey.value = false;
  }
};

const removeKey = async () => {
  apiKey.value = '';
  await saveKey();
};

const loadMatch = async () => {
  error.value = '';
  result.value = null;
  match.value = null;
  isLoading.value = true;
  try {
    match.value = await request('/preview', 'POST', { input: input.value });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    isLoading.value = false;
  }
};

const doImport = async () => {
  error.value = '';
  isImporting.value = true;
  try {
    result.value = await request('/import', 'POST', { input: input.value, setCurrent: setCurrent.value });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    isImporting.value = false;
  }
};

onMounted(loadSettings);
</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-screen">
    <h1 class="text-2xl font-bold text-text-main mb-1">FACEIT</h1>
    <p class="text-sm text-zinc-500 mb-6">
      Match-Link oder Match-ID einfügen. Teams, Logos und Spieler werden geladen und als Match angelegt.
    </p>

    <!-- Match input -->
    <div class="max-w-3xl flex flex-col gap-4">
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <BaseInput
            :model-value="input"
            @update:model-value="input = $event as string"
            label="FACEIT Match-Link oder Match-ID"
            placeholder="https://www.faceit.com/de/cs2/room/1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <BaseButton variant="primary" :disabled="!input.trim() || isLoading" @click="loadMatch">
          {{ isLoading ? 'Lädt…' : 'Match laden' }}
        </BaseButton>
      </div>

      <p v-if="error" class="text-sm text-red-400 bg-red-900/20 border border-red-900/50 rounded-lg px-3 py-2">{{ error }}</p>

      <!-- Preview -->
      <div v-if="match" class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
        <div class="flex items-center justify-between text-xs text-zinc-500">
          <span>{{ match.competition || 'FACEIT Match' }} · BO{{ match.bestOf }} · {{ match.status }}</span>
          <span>Quelle: {{ match.source === 'api' ? 'FACEIT API' : 'öffentlicher Endpunkt' }}</span>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div v-for="team in match.teams" :key="team.factionId || team.name" class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
              <img v-if="team.avatar" :src="team.avatar" class="size-10 object-contain rounded" referrerpolicy="no-referrer" />
              <span class="font-bold text-text-main">{{ team.name }}</span>
            </div>
            <ul class="text-sm flex flex-col gap-1">
              <li v-for="p in team.players" :key="p.playerId" class="flex items-center gap-2">
                <img v-if="p.avatar" :src="p.avatar" class="size-5 rounded-full object-cover" referrerpolicy="no-referrer" />
                <span>{{ p.nickname }}</span>
                <span class="text-xs text-zinc-600 ml-auto">{{ p.steamId || 'keine Steam-ID' }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-zinc-800 pt-3">
          <BaseCheckbox v-model="setCurrent" label="Als aktuelles Match setzen" />
          <BaseButton variant="primary" :disabled="isImporting" @click="doImport">
            {{ isImporting ? 'Importiert…' : 'Importieren' }}
          </BaseButton>
        </div>
      </div>

      <!-- Result -->
      <div v-if="result" class="text-sm bg-emerald-900/20 border border-emerald-900/50 rounded-lg px-3 py-2 text-emerald-300">
        Importiert: Teams {{ result.teamsCreated }} neu / {{ result.teamsUpdated }} aktualisiert,
        Spieler {{ result.playersCreated }} neu / {{ result.playersUpdated }} aktualisiert.
        <ul v-if="result.warnings.length" class="mt-2 text-amber-300 list-disc list-inside">
          <li v-for="w in result.warnings" :key="w">{{ w }}</li>
        </ul>
      </div>

      <!-- API settings -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-xl">
        <button class="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300" @click="settingsOpen = !settingsOpen">
          <span>API-Einstellungen</span>
          <span class="text-xs font-normal" :class="apiKeySet ? 'text-emerald-400' : 'text-amber-400'">
            {{ apiKeySet ? `API-Key gesetzt (${apiKeyHint})` : 'kein API-Key' }}
          </span>
        </button>
        <div v-if="settingsOpen" class="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-800 pt-3">
          <p class="text-xs text-zinc-500">
            Mit API-Key nutzt das Tool die offizielle FACEIT Data API (empfohlen). Einen Server-side-Key erstellst du im
            FACEIT Developer Portal (developers.faceit.com). Ohne Key wird ein inoffizieller Endpunkt versucht, der
            jederzeit ausfallen kann. Der Key wird nur lokal gespeichert.
          </p>
          <div class="flex gap-2 items-end">
            <div class="flex-1">
              <BaseInput :model-value="apiKey" @update:model-value="apiKey = $event as string" type="password" label="API-Key" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </div>
            <BaseButton variant="primary" :disabled="!apiKey.trim() || savingKey" @click="saveKey">Speichern</BaseButton>
            <BaseButton v-if="apiKeySet" variant="danger" :disabled="savingKey" @click="removeKey">Entfernen</BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
