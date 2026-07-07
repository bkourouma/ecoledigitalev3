"use client";

import { type ReactNode } from "react";
import {
  MINISTERE,
  REPUBLIQUE,
  INSTITUT,
  DECISION_TITRE,
  VISA_DIRECTEUR,
  FOOTER_NOTE,
  FOOTER_ADDRESS,
  LOGO_INSTITUT,
  LOGO_EMBLEME,
  IPAM_GREEN,
  OK_GREEN,
  BAD_RED,
  fmtNote,
  appreciation,
  niveauOf,
  fmtDateLongFr,
  genreLabel,
  decisionLabel,
  releveSemestreTitre,
  semShort,
  sessionLabel,
  ueEtatLabel,
  ueEtatColor,
  juryIntro,
  JURY_RESULTATS,
  JURY_NB,
} from "@/lib/bulletin-format";

/**
 * Relevé de notes officiel — Module Professionnel (feature 030).
 * Feuille A4 (marges Word), identité IPAM (vert), filigrane, tableau UE→ECUE
 * groupé par catégorie, statuts colorés, synthèse, décision, QR de vérification,
 * rang et cachet. Compatible impression.
 */

const cellBase = "border border-gray-700 px-1.5 py-[4px] text-[12px] align-middle";
const th = "border border-gray-700 px-1.5 py-1.5 text-[11px] font-bold text-center align-middle leading-tight";

function decisionColor(d: string): string {
  return d === "admis" ? OK_GREEN : d === "rattrapage" ? "#B45309" : BAD_RED;
}

export function BulletinView({ bulletin }: { bulletin: any }) {
  if (!bulletin) return null;

  const sem = semShort(bulletin.semestre?.libelle);

  const studentName = `${bulletin.student?.last_name ?? ""} ${bulletin.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const ne = `${fmtDateLongFr(bulletin.student?.date_of_birth)}${
    bulletin.student?.place_of_birth ? ` à ${bulletin.student.place_of_birth}` : ""
  }`;
  const totalObtenus = bulletin.credits_valides ?? 0;
  const totalUe = bulletin.credits_total ?? 0;
  // Date officielle : date de génération PERMANENTE du bulletin si généré,
  // sinon date du jour (consultation d'un bulletin non encore généré).
  const officialDate = bulletin.generated_at ? new Date(bulletin.generated_at) : new Date();
  const today = officialDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const isProvisoire = bulletin.bulletin_statut === "provisoire" || bulletin.decision !== "admis";
  // Catégories (fallback : une pseudo-catégorie regroupant toutes les UE).
  const categories: any[] =
    bulletin.categories?.length > 0
      ? bulletin.categories
      : [{ key: "_all", ues: bulletin.ues ?? [], credits_obtenus: totalObtenus, credits_ue: totalUe }];

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { background: white !important; }
          .bulletin-sheet { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      <div
        className="bulletin-sheet relative bg-white text-gray-900 shadow-xl mx-auto flex flex-col overflow-hidden"
        style={{
          width: "210mm",
          minHeight: "297mm",
          maxWidth: "100%",
          padding: "12mm 12mm 10mm 12mm",
          fontFamily: "'Times New Roman', Georgia, serif",
        }}
      >
        {/* Filigrane */}
        <img
          src={LOGO_INSTITUT}
          alt=""
          aria-hidden
          className="pointer-events-none select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[120mm] object-contain"
          style={{ opacity: 0.05 }}
        />

        <div className="relative z-10 flex flex-col flex-1">
          {/* ---------- En-tête ---------- */}
          <div className="grid grid-cols-[1fr_1.1fr_1fr] items-start gap-2">
            <div className="flex flex-col items-start">
              <p className="text-[10px] leading-snug whitespace-pre-line">{MINISTERE}</p>
              <img src={LOGO_INSTITUT} alt="IPAM" className="h-24 mt-2 object-contain" />
            </div>
            <div className="flex flex-col items-center justify-center pt-6">
              <div className="px-4 py-0.5 border-2" style={{ borderColor: IPAM_GREEN }}>
                <p className="font-bold text-[12px] whitespace-nowrap" style={{ color: IPAM_GREEN }}>
                  {releveSemestreTitre(bulletin.semestre?.libelle)}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end text-right">
              <p className="text-[10px] leading-snug whitespace-pre-line">{REPUBLIQUE}</p>
              <img src={LOGO_EMBLEME} alt="Emblème" className="h-20 mt-1 object-contain" />
              <p className="text-[11px] mt-1">
                <span className="font-semibold">Année scolaire :</span> {bulletin.annee_academique ?? "—"}
              </p>
            </div>
          </div>

          {/* ---------- Nom de l'institut (pleine largeur, une ligne) ---------- */}
          <p
            className="text-center font-bold text-[13.5px] tracking-wide -mt-3 whitespace-nowrap"
            style={{ color: IPAM_GREEN }}
          >
            {INSTITUT}
          </p>

          {/* ---------- Jury : introduction ---------- */}
          {isProvisoire && (
            <p className="mt-3 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-center text-[11px] font-semibold text-amber-700 print:hidden">
              BULLETIN PROVISOIRE — en attente de Session 2 (rattrapage)
            </p>
          )}
          <p className="text-[12px] mt-6 leading-snug">{juryIntro(officialDate)}</p>

          {/* ---------- Bloc scolarité ---------- */}
          <div className="mt-2 grid grid-cols-[1.25fr_1fr] gap-x-8 gap-y-1.5 text-[12px]">
            <InfoLine label="Nom et prénoms" value={studentName || "—"} strong />
            <InfoLine label="Matricule" value={String(bulletin.student?.matricule ?? "—")} />
            <InfoLine label="Né(e) le" value={ne} />
            <InfoLine label="Genre" value={genreLabel(bulletin.student?.gender)} />
            <InfoLine label="Spécialité" value={bulletin.filiere?.name ?? "—"} />
            <InfoLine label="Redoublant(e)" value={bulletin.student?.is_repeating ? "OUI" : "NON"} />
            <InfoLine label="Niveau" value={niveauOf(bulletin.filiere?.name)} />
            <InfoLine label="Domaine" value={bulletin.filiere?.domaine ?? "—"} />
          </div>

          {/* ---------- Textes jury avant le tableau ---------- */}
          <p className="text-[12px] mt-3 leading-snug">{JURY_RESULTATS}</p>
          <p className="text-[12px] font-semibold mt-1 leading-snug">{JURY_NB}</p>

          {/* ---------- Tableau ---------- */}
          <table className="w-full border-collapse mt-3" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "46%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: IPAM_GREEN, color: "white" }}>
                <th className={th}>UNITÉ D'ENSEIGNEMENTS</th>
                <th className={th}>Sem</th>
                <th className={th}>Note</th>
                <th className={th}>Moy</th>
                <th className={th}>Appréciation</th>
                <th className={th}>Crédits</th>
                <th className={th}>Session</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <CategoryGroup key={cat.key} cat={cat} sem={sem} />
              ))}
            </tbody>
          </table>

          {/* ---------- Synthèse ---------- */}
          <table className="w-full border-collapse mt-5 text-center" style={{ tableLayout: "fixed" }}>
            <tbody>
              <tr className="text-[11px]" style={{ backgroundColor: IPAM_GREEN, color: "white" }}>
                <SumHead>Session</SumHead>
                <SumHead>Crédits</SumHead>
                <SumHead>
                  Nombre d'UE
                  <br />
                  validés
                </SumHead>
                <SumHead>Moyenne</SumHead>
                <SumHead>Appréciation</SumHead>
              </tr>
              <tr className="text-[12px] font-semibold">
                <SumCell>{sessionLabel(bulletin.session_globale ?? 1)}</SumCell>
                <SumCell>
                  {totalObtenus}/{totalUe}
                </SumCell>
                <SumCell>
                  {bulletin.nb_ue_validees ?? 0}/{bulletin.nb_ue_total ?? 0}
                </SumCell>
                <SumCell>{fmtNote(bulletin.moyenne_session)}</SumCell>
                <SumCell>{appreciation(bulletin.moyenne_session)}</SumCell>
              </tr>
            </tbody>
          </table>

          <p className="text-[12px] mt-4">
            En foi de quoi, il lui est délivré le présent relevé de notes pour servir et valoir ce que de
            droit.
          </p>

          {/* ---------- Bas : décision · visa ---------- */}
          <div className="flex justify-between items-end mt-5 text-[12px]">
            <div className="flex flex-col items-start" />
            <div className="text-center">
              <p className="font-bold underline">{DECISION_TITRE}</p>
              <p
                className="font-bold text-[16px] mt-3"
                style={{ color: decisionColor(bulletin.decision) }}
              >
                {decisionLabel(bulletin.decision)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px]">Fait à Abidjan, le {today}</p>
              <p className="font-bold underline mt-1">{VISA_DIRECTEUR}</p>
              <div className="h-14" />
            </div>
          </div>

          {/* ---------- Pied de page ---------- */}
          <div className="mt-auto pt-4">
            <div
              className="border-t pt-1.5 text-center text-[9px] leading-snug text-gray-700"
              style={{ borderColor: IPAM_GREEN }}
            >
              <p>{FOOTER_NOTE}</p>
              <p className="whitespace-pre-line">{FOOTER_ADDRESS}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SumHead({ children }: { children: ReactNode }) {
  return <td className="border border-gray-700 px-2 py-1 font-bold leading-tight">{children}</td>;
}
function SumCell({ children }: { children: ReactNode }) {
  return <td className="border border-gray-700 px-2 py-1">{children}</td>;
}

function InfoLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex items-baseline gap-2">
      <span
        className="font-bold underline underline-offset-2 whitespace-nowrap"
        style={{ color: IPAM_GREEN }}
      >
        {label}
      </span>
      <span className={strong ? "font-bold" : ""}>{value}</span>
    </p>
  );
}

/** UE d'une catégorie (sans bandeau de titre), avec zébrage. */
function CategoryGroup({ cat, sem }: { cat: any; sem: string }) {
  return (
    <>
      {cat.ues.map((ue: any, i: number) => (
        <UeBlock key={ue.ue_session_id ?? ue.ue_id} ue={ue} zebra={i % 2 === 1} sem={sem} />
      ))}
    </>
  );
}

function UeBlock({ ue, zebra, sem }: { ue: any; zebra: boolean; sem: string }) {
  const zbg = zebra ? "#F7FAF8" : undefined;
  return (
    <>
      {/* Ligne UE : Nom (occupe Nom+Sem+Note) · Moy · Décision · Crédit total · Session */}
      <tr className="font-semibold" style={{ backgroundColor: zbg }}>
        <td className={`${cellBase} uppercase`} colSpan={3}>
          {ue.libelle ?? ue.code ?? "—"}
        </td>
        <td className={`${cellBase} text-center font-bold`}>{fmtNote(ue.moyenne_ue)}</td>
        <td
          className={`${cellBase} text-center font-semibold`}
          style={{ color: ueEtatColor(ue.etat) }}
        >
          {ueEtatLabel(ue.etat)}
        </td>
        <td className={`${cellBase} text-center`}>{ue.credits}</td>
        <td className={`${cellBase} text-center`}>{sessionLabel(ue.session_validation)}</td>
      </tr>
      {ue.ecues.map((e: any) => (
        <tr key={e.ecue_id} className="text-[11px]" style={{ backgroundColor: zbg }}>
          <td className={`${cellBase} pl-4 text-gray-700`}>{e.libelle ?? e.code ?? "—"}</td>
          <td className={`${cellBase} text-center`}>{sem}</td>
          <td className={`${cellBase} text-center`}>{fmtNote(e.note_ecue)}</td>
          <td className={cellBase} />
          <td className={`${cellBase} text-center`}>{appreciation(e.note_ecue)}</td>
          <td className={`${cellBase} text-center`}>{e.credits ?? "—"}</td>
          <td className={cellBase} />
        </tr>
      ))}
    </>
  );
}
