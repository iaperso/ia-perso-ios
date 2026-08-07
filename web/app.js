import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const els = {
  statusDot: $("statusDot"), statusTitle: $("statusTitle"), statusText: $("statusText"),
  progressBar: $("progressBar"), modelSelect: $("modelSelect"), loadButton: $("loadButton"),
  messages: $("messages"), form: $("chatForm"), input: $("promptInput"), send: $("sendButton"),
  newChat: $("newChatButton"), clear: $("clearButton"), privacy: $("privacyText")
};

let engine = null;
let isGenerating = false;
let history = loadHistory();
const systemMessage = { role: "system", content: "Tu es IA Perso, un assistant utile, clair et concis. Tu réponds en français sauf demande contraire." };

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("ia-perso-web-history") || "[]"); }
  catch { return []; }
}
function saveHistory() { localStorage.setItem("ia-perso-web-history", JSON.stringify(history)); }
function escapeText(text) { const p = document.createElement("p"); p.textContent = text; return p.innerHTML; }
function addMessage(role, text, persist = true) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = role === "user" ? "Moi" : "IA";
  const bubble = document.createElement("div"); bubble.className = "bubble";
  const p = document.createElement("p"); p.innerHTML = escapeText(text); bubble.appendChild(p);
  article.append(avatar, bubble); els.messages.appendChild(article); els.messages.scrollTop = els.messages.scrollHeight;
  if (persist) { history.push({ role, content: text }); saveHistory(); }
  return p;
}
function renderHistory() {
  if (!history.length) return;
  els.messages.innerHTML = "";
  for (const message of history) addMessage(message.role, message.content, false);
}
function setStatus(title, text, mode = "idle", progress = 0) {
  els.statusTitle.textContent = title; els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${mode === "ready" ? "ready" : mode === "error" ? "error" : ""}`;
  els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

async function checkWebGPU() {
  if (!("gpu" in navigator)) {
    setStatus("WebGPU indisponible", "Cette version web nécessite Safari 26+ ou un navigateur compatible WebGPU.", "error", 0);
    els.loadButton.disabled = true;
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Aucun GPU compatible");
    setStatus("Prêt à télécharger le modèle", "Au premier chargement, le modèle est téléchargé puis mis en cache dans Safari.", "ready", 0);
    return true;
  } catch (error) {
    setStatus("GPU non disponible", error.message || "WebGPU n’est pas utilisable sur cet appareil.", "error", 0);
    els.loadButton.disabled = true;
    return false;
  }
}

async function loadModel() {
  if (engine) {
    try { await engine.unload(); } catch {}
    engine = null;
  }
  els.loadButton.disabled = true; els.send.disabled = true; els.modelSelect.disabled = true;
  const model = els.modelSelect.value;
  try {
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (report) => {
        const pct = Math.round((report.progress || 0) * 100);
        setStatus("Chargement de l’IA…", report.text || `Téléchargement ${pct}%`, "idle", pct);
      }
    });
    setStatus("IA prête", "Le modèle tourne localement dans ce navigateur. Tu peux discuter maintenant.", "ready", 100);
    els.privacy.textContent = "Calcul local dans le navigateur · aucune clé API";
    els.send.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Échec du chargement", error?.message || "Impossible de charger le modèle.", "error", 0);
  } finally {
    els.loadButton.disabled = false; els.modelSelect.disabled = false;
  }
}

async function sendMessage(text) {
  if (!engine || isGenerating || !text.trim()) return;
  isGenerating = true; els.send.disabled = true; els.input.disabled = true;
  const userText = text.trim(); addMessage("user", userText);
  const assistantP = addMessage("assistant", "", false);
  let answer = "";
  try {
    const messages = [systemMessage, ...history];
    const chunks = await engine.chat.completions.create({ messages, temperature: 0.7, stream: true, stream_options: { include_usage: true } });
    for await (const chunk of chunks) {
      answer += chunk.choices?.[0]?.delta?.content || "";
      assistantP.textContent = answer;
      els.messages.scrollTop = els.messages.scrollHeight;
    }
    if (!answer.trim()) answer = await engine.getMessage();
    assistantP.textContent = answer;
    history.push({ role: "assistant", content: answer }); saveHistory();
  } catch (error) {
    console.error(error); assistantP.textContent = `Erreur : ${error?.message || "génération impossible"}`;
  } finally {
    isGenerating = false; els.input.disabled = false; els.send.disabled = false; els.input.focus();
  }
}

els.loadButton.addEventListener("click", loadModel);
els.form.addEventListener("submit", (event) => { event.preventDefault(); const text = els.input.value; els.input.value = ""; els.input.style.height = "auto"; sendMessage(text); });
els.input.addEventListener("input", () => { els.input.style.height = "auto"; els.input.style.height = `${Math.min(150, els.input.scrollHeight)}px`; });
els.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); els.form.requestSubmit(); } });
els.newChat.addEventListener("click", () => { history = []; saveHistory(); els.messages.innerHTML = ""; addMessage("assistant", "Nouvelle conversation. Que veux-tu faire ?", false); });
els.clear.addEventListener("click", () => { history = []; localStorage.removeItem("ia-perso-web-history"); els.messages.innerHTML = ""; addMessage("assistant", "Historique effacé.", false); });

renderHistory();
checkWebGPU();
