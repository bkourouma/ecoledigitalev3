"use client";

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
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
  ueDecision,
  niveauOf,
  fmtDateLongFr,
  genreLabel,
  decisionLabel,
  semestreOrdinalFr,
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
  const [qr, setQr] = useState<string>("");
  useEffect(() => {
    if (bulletin?.reference) {
      QRCode.toDataURL(String(bulletin.reference), { margin: 0, width: 140 })
        .then(setQr)
        .catch(() => setQr(""));
    }
  }, [bulletin?.reference]);

  if (!bulletin) return null;

  const studentName = `${bulletin.student?.last_name ?? ""} ${bulletin.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const ne = `${fmtDateLongFr(bulletin.student?.date_of_birth)}${
    bulletin.student?.place_of_birth ? ` à ${bulletin.student.place_of_birth}` : ""
  }`;
  const totalObtenus = bulletin.credits_valides ?? 0;
  const totalUe = bulletin.credits_total ?? 0;
  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
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
            <div className="flex flex-col items-center pt-2">
              <p className="font-bold text-[17px] tracking-wide mt-6" style={{ color: IPAM_GREEN }}>
                BULLETIN DE NOTES
              </p>
              <div className="px-6 py-0.5 mt-1 border-2" style={{ borderColor: IPAM_GREEN }}>
                <p className="font-bold text-[13px]" style={{ color: IPAM_GREEN }}>
                  {semestreOrdinalFr(bulletin.semestre?.libelle)}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end text-right">
              <p className="text-[10px] leading-snug whitespace-pre-line">{REPUBLIQUE}</p>
              <img src={LOGO_EMBLEME} alt="Emblème" className="h-20 mt-1 object-contain" />
              <p className="text-[11px] mt-1">
                <span className="font-semibold">Année scolaire :</span> {bulletin.annee_academique ?? "—"}
              </p>
              <p className="text-[11px]">
                <span className="font-semibold">Effectif :</span> {bulletin.effectif ?? "—"}
              </p>
            </div>
          </div>

          <p className="text-center font-bold text-[15px] tracking-wide mt-1" style={{ color: IPAM_GREEN }}>
            {INSTITUT}
          </p>

          {/* ---------- Bloc scolarité ---------- */}
          <div className="mt-4 grid grid-cols-[1.25fr_1fr] gap-x-8 gap-y-1.5 text-[12px]">
            <InfoLine label="Nom et prénoms" value={studentName || "—"} strong />
            <InfoLine label="Matricule" value={String(bulletin.student?.matricule ?? "—")} />
            <InfoLine label="Né(e) le" value={ne} />
            <InfoLine label="Genre" value={genreLabel(bulletin.student?.gender)} />
            <InfoLine label="Filière" value={bulletin.filiere?.name ?? "—"} />
            <InfoLine label="Redoublant(e)" value={bulletin.student?.is_repeating ? "OUI" : "NON"} />
            <InfoLine label="Niveau" value={niveauOf(bulletin.filiere?.name)} />
          </div>

          {/* ---------- Tableau ---------- */}
          <table className="w-full border-collapse mt-3" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "30%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: IPAM_GREEN, color: "white" }}>
                <th className={th}>UNITÉ D'ENSEIGNEMENTS</th>
                <th className={th}>Contrôle continu</th>
                <th className={th}>Examen</th>
                <th className={th}>Moyenne ECUE</th>
                <th className={th}>Moyenne UE</th>
                <th className={th}>Appréciation</th>
                <th className={th}>Crédits obtenus</th>
                <th className={th}>Crédit UE</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <CategoryGroup key={cat.key} cat={cat} />
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
                <SumHead>Rang</SumHead>
                <SumHead>Moyenne</SumHead>
                <SumHead>Appréciation</SumHead>
              </tr>
              <tr className="text-[12px] font-semibold">
                <SumCell>Session 1</SumCell>
                <SumCell>
                  {totalObtenus}/{totalUe}
                </SumCell>
                <SumCell>
                  {bulletin.nb_ue_validees ?? 0}/{bulletin.nb_ue_total ?? 0}
                </SumCell>
                <SumCell>{bulletin.rang ? `${bulletin.rang}/${bulletin.effectif ?? "—"}` : "—"}</SumCell>
                <SumCell>{fmtNote(bulletin.moyenne_session)}</SumCell>
                <SumCell>{appreciation(bulletin.moyenne_session)}</SumCell>
              </tr>
            </tbody>
          </table>

          <p className="text-[12px] mt-4">
            En foi de quoi, il lui est délivré le présent relevé de notes pour servir et valoir ce que de
            droit.
          </p>

          {/* ---------- Bas : QR/réf · décision · visa ---------- */}
          <div className="flex justify-between items-end mt-5 text-[12px]">
            <div className="flex flex-col items-start">
              {qr && <img src={qr} alt="QR" className="w-[22mm] h-[22mm]" />}
              <p className="font-mono text-[8.5px] mt-1">N° {bulletin.reference ?? "—"}</p>
            </div>
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
function CategoryGroup({ cat }: { cat: any }) {
  return (
    <>
      {cat.ues.map((ue: any, i: number) => (
        <UeBlock key={ue.ue_session_id ?? ue.ue_id} ue={ue} zebra={i % 2 === 1} />
      ))}
    </>
  );
}

function UeBlock({ ue, zebra }: { ue: any; zebra: boolean }) {
  const obtenus = ue.validee ? ue.credits : 0;
  const zbg = zebra ? "#F7FAF8" : undefined;
  return (
    <>
      {/* Ligne UE — nom fusionné sur 4 colonnes */}
      <tr className="font-semibold" style={{ backgroundColor: zbg }}>
        <td className={`${cellBase} uppercase whitespace-nowrap`} colSpan={4}>
          {ue.libelle ?? ue.code ?? "—"}
        </td>
        <td className={`${cellBase} text-center font-bold`}>{fmtNote(ue.moyenne_ue)}</td>
        <td
          className={`${cellBase} text-center font-semibold`}
          style={{ color: ue.validee ? OK_GREEN : BAD_RED }}
        >
          {ueDecision(ue.validee)}
        </td>
        <td className={`${cellBase} text-center`}>{obtenus}</td>
        <td className={`${cellBase} text-center`}>{ue.credits}</td>
      </tr>
      {ue.ecues.map((e: any) => (
        <tr key={e.ecue_id} className="text-[11px]" style={{ backgroundColor: zbg }}>
          <td className={`${cellBase} pl-4 text-gray-700`}>{e.libelle ?? e.code ?? "—"}</td>
          <td className={`${cellBase} text-center`}>{fmtNote(e.moyenne_devoirs)}</td>
          <td className={`${cellBase} text-center`}>{fmtNote(e.note_examen)}</td>
          <td className={`${cellBase} text-center`}>{fmtNote(e.note_ecue)}</td>
          <td className={cellBase} />
          <td className={`${cellBase} text-center`}>{appreciation(e.note_ecue)}</td>
          <td className={cellBase} />
          <td className={cellBase} />
        </tr>
      ))}
    </>
  );
}
