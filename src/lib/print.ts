// Exports imprimables (fiche bilan élève, bilan de classe).
// On génère un document HTML autonome ouvert dans un nouvel onglet, qui
// lance l'impression : le professeur imprime ou « enregistre en PDF ».
// Les fonctions de construction sont pures (testables hors navigateur).

import { agentById } from "./agents";
import { levelInfo } from "./gamification";
import { parseAssistantContent } from "./markers";
import type { ChatMessage } from "./types";

// Tout contenu venant des élèves passe par ici (sécurité)
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const esc = escapeHtml;

function frDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 2px solid #f0a161; padding-bottom: 2px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  .meta { color: #555; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0; }
  th, td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; font-size: 12px; vertical-align: top; }
  th { background: #faf0e6; }
  .msg { margin: 3px 0; page-break-inside: avoid; }
  .who { font-weight: 700; }
  .agent .who { color: #b45309; }
  .user .who { color: #5b21b6; }
  .tip { color: #92400e; font-size: 11.5px; margin: 1px 0 6px 14px; }
  .vocab li { display: inline-block; width: 48%; font-size: 12px; }
  .empty { color: #777; font-style: italic; }
  footer { margin-top: 26px; padding-top: 6px; border-top: 1px solid #ccc; color: #777; font-size: 11px; }
  @page { margin: 15mm; }
`;

export function openPrintWindow(title: string, bodyHtml: string) {
  const w = window.open("", "_blank");
  if (!w) {
    window.alert(
      "Le navigateur a bloqué l'ouverture de la page d'impression : autorise les fenêtres pop-up pour ce site.",
    );
    return;
  }
  w.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`,
  );
  w.document.close();
}

// ---------------------------------------------------------------
// Fiche bilan d'un élève
// ---------------------------------------------------------------

export interface PrintProgress {
  xp: number;
  msg_count: number;
  missions_completed: number;
  best_mission: number;
  vocab: { es: string; fr: string }[];
  updated_at?: string;
}

export interface PrintReport {
  total: number;
  comprension: number;
  expresion: number;
  lexico: number;
  insignia: string;
  consejo: string;
  created_at: string;
}

export interface PrintConv {
  agent_id: string;
  level: string;
  messages: ChatMessage[];
}

export function studentReportHtml(args: {
  studentName: string;
  className: string;
  progress?: PrintProgress;
  reports: PrintReport[];
  convs: PrintConv[];
  printedAt?: Date;
}): string {
  const { studentName, className, progress, reports, convs } = args;
  const printedAt = (args.printedAt ?? new Date()).toLocaleDateString("fr-FR");
  const vocab = Array.isArray(progress?.vocab) ? progress.vocab : [];
  const lvl = levelInfo(progress?.xp ?? 0);

  const synthese = `<table><tr>
    <th>XP</th><th>Niveau</th><th>Messages envoyés</th><th>Missions terminées</th><th>Meilleur score</th><th>Mots au carnet</th><th>Dernière activité</th></tr><tr>
    <td>${progress?.xp ?? 0}</td><td>${lvl.level}</td><td>${progress?.msg_count ?? 0}</td>
    <td>${progress?.missions_completed ?? 0}</td><td>${progress?.best_mission ?? 0}/12</td>
    <td>${vocab.length}</td><td>${frDate(progress?.updated_at)}</td></tr></table>`;

  const missions =
    reports.length === 0
      ? `<p class="empty">Aucune mission terminée pour l'instant.</p>`
      : `<table><tr><th>Date</th><th>Score</th><th>Compréhension</th><th>Expression</th><th>Lexique</th><th>Insigne</th><th>Conseil</th></tr>${reports
          .map(
            (r) =>
              `<tr><td>${frDate(r.created_at)}</td><td><b>${r.total}/12</b></td><td>${r.comprension}/4</td><td>${r.expresion}/4</td><td>${r.lexico}/4</td><td>${esc(r.insignia ?? "")}</td><td>${esc(r.consejo ?? "")}</td></tr>`,
          )
          .join("")}</table>`;

  const carnet =
    vocab.length === 0
      ? `<p class="empty">Carnet vide pour l'instant.</p>`
      : `<ul class="vocab">${vocab
          .map((v) => `<li><b>${esc(v.es)}</b> — ${esc(v.fr)}</li>`)
          .join("")}</ul>`;

  const conversations =
    convs.length === 0
      ? `<p class="empty">Aucune conversation enregistrée.</p>`
      : convs
          .map((c) => {
            const agent = agentById(c.agent_id);
            const msgs = (c.messages ?? []).filter(
              (m) => !m.error && m.content.trim().length > 0,
            );
            const lines = msgs
              .map((m) => {
                if (m.role === "user") {
                  return `<div class="msg user"><span class="who">${esc(studentName)} :</span> ${esc(m.content)}</div>`;
                }
                const parsed = parseAssistantContent(m.content);
                const tip = parsed.tip
                  ? `<div class="tip">💡 Astuce : ${esc(parsed.tip)}</div>`
                  : "";
                return `<div class="msg agent"><span class="who">${esc(agent.nombre)} :</span> ${esc(parsed.text)}</div>${tip}`;
              })
              .join("");
            return `<h3>${agent.emoji} ${esc(agent.nombre)} — ${msgs.length} messages (niveau ${esc(c.level)})</h3>${lines}`;
          })
          .join("");

  return `<h1>🦜 ¡Charlemos! — Fiche bilan</h1>
  <p class="meta">Élève : <b>${esc(studentName)}</b> · Classe : ${esc(className)} · Imprimé le ${printedAt}</p>
  <h2>Synthèse</h2>${synthese}
  <h2>Rapports de mission (${reports.length})</h2>${missions}
  <h2>Carnet de mots (${vocab.length})</h2>${carnet}
  <h2>Conversations</h2>${conversations}
  <footer>Document généré par ¡Charlemos! — les lignes « 💡 Astuce » sont les corrections bienveillantes proposées à l'élève pendant la conversation.</footer>`;
}

// ---------------------------------------------------------------
// Bilan de classe (tableau récapitulatif)
// ---------------------------------------------------------------

export function classReportHtml(args: {
  className: string;
  joinCode: string;
  rows: { name: string; progress?: PrintProgress; reportCount: number }[];
  printedAt?: Date;
}): string {
  const printedAt = (args.printedAt ?? new Date()).toLocaleDateString("fr-FR");
  const body =
    args.rows.length === 0
      ? `<p class="empty">Aucun élève inscrit pour l'instant.</p>`
      : `<table><tr><th>Élève</th><th>XP</th><th>Niveau</th><th>Messages</th><th>Missions</th><th>Meilleur score</th><th>Mots au carnet</th><th>Dernière activité</th></tr>${args.rows
          .map((r) => {
            const vocab = Array.isArray(r.progress?.vocab) ? r.progress.vocab : [];
            return `<tr><td><b>${esc(r.name)}</b></td><td>${r.progress?.xp ?? 0}</td><td>${levelInfo(r.progress?.xp ?? 0).level}</td><td>${r.progress?.msg_count ?? 0}</td><td>${r.progress?.missions_completed ?? 0}</td><td>${r.progress?.best_mission ?? 0}/12</td><td>${vocab.length}</td><td>${frDate(r.progress?.updated_at)}</td></tr>`;
          })
          .join("")}</table>`;
  return `<h1>🦜 ¡Charlemos! — Bilan de classe</h1>
  <p class="meta">Classe : <b>${esc(args.className)}</b> (code ${esc(args.joinCode)}) · ${args.rows.length} élève(s) · Imprimé le ${printedAt}</p>
  ${body}
  <footer>Document généré par ¡Charlemos! — pour le détail d'un élève (missions, transcriptions, carnet), utiliser la fiche bilan individuelle.</footer>`;
}
