// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/platform/test/render";
import { expectNoBlockingViolations } from "@/platform/test/axe";
import { Shell } from "@/platform/admin/shell/Shell";
import { PlatformSidebar } from "@/platform/navigation/PlatformSidebar";
import type { MenuItem } from "@/platform/navigation/types";
import { DataTable, type DataTableColumn } from "./DataTable";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "./FormField";
import { FormDialog, ModalDialog, ReasonDialog } from "./ModalDialog";
import { PageHeader, StatusBadge } from "./PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "./states";
import { UploadDropzone } from "./UploadDropzone";
import { Wizard } from "./Wizard";

vi.mock("next/navigation", () => ({ usePathname: () => "/v2/audit", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.setConfig({ testTimeout: 30_000 });

interface Row {
  id: string;
  name: string;
  status: string;
}
const rows: Row[] = [
  { id: "1", name: "Awa Traoré", status: "Actif" },
  { id: "2", name: "Koffi Yao", status: "Suspendu" },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Nom", headerLabel: "Nom", cell: (r) => r.name, sortable: true, rowHeader: true },
  { id: "status", header: "Statut", cell: (r) => <StatusBadge label={r.status} tone="success" /> },
];

const item = (key: string, href: string, label: string): MenuItem => ({ key, href, label, permission: "x.read", portal: "admin" });
const items = [item("a", "/v2/access/roles", "Rôles"), item("b", "/v2/audit", "Audit")];

describe("garde-fou du harnais axe", () => {
  it("détecte bien un champ sans libellé et un bouton sans nom (sinon le harnais ne prouverait rien)", async () => {
    const { container, unmount } = renderWithProviders(
      <div>
        <input type="text" />
        <button type="button" />
      </div>,
    );
    await expect(expectNoBlockingViolations(container)).rejects.toThrow(/label|button-name/);
    unmount(); // le balayage transversal (`test:a11y`) ne doit pas retrouver ce DOM volontairement fautif
  });
});

describe("accessibilité (axe) des composants partagés", () => {
  it("DataTable : données, tri, pagination, chargement, vide, erreur", async () => {
    const { container, rerender } = renderWithProviders(
      <DataTable caption="Élèves" columns={columns} rows={rows} getRowId={(r) => r.id} sort={{ id: "name", direction: "asc" }} onSortChange={() => undefined} pagination={{ page: 1, pageSize: 2, total: 5, onPageChange: () => undefined, pageSizeOptions: [10, 25], onPageSizeChange: () => undefined }} />,
    );
    await expectNoBlockingViolations(container);
    rerender(<DataTable caption="Élèves" columns={columns} rows={[]} getRowId={(r) => r.id} isLoading />);
    await expectNoBlockingViolations(container);
    rerender(<DataTable caption="Élèves" columns={columns} rows={[]} getRowId={(r) => r.id} emptyTitle="Aucun élève" />);
    await expectNoBlockingViolations(container);
    rerender(<DataTable caption="Élèves" columns={columns} rows={[]} getRowId={(r) => r.id} error={new Error("x")} onRetry={() => undefined} />);
    await expectNoBlockingViolations(container);
  });

  it("champs de formulaire : libellé, aide, erreur, obligatoire, liste, case à cocher", async () => {
    const { container } = renderWithProviders(
      <form aria-label="Formulaire">
        <FormField label="Nom" required error="Champ obligatoire" hint="Nom légal">
          {(c) => <TextControl {...c} value="" onChange={() => undefined} />}
        </FormField>
        <FormField label="Niveau">
          {(c) => <NativeSelect {...c} value="" onChange={() => undefined} placeholder="Choisir" options={[{ value: "CP1", label: "CP1" }]} />}
        </FormField>
        <FormField label="Remarques">{(c) => <TextAreaControl {...c} value="" onChange={() => undefined} />}</FormField>
        <CheckControl checked={false} onChange={() => undefined} label="J'accepte" hint="Obligatoire" />
      </form>,
    );
    await expectNoBlockingViolations(container);
  });

  it("dialogues : ModalDialog, FormDialog, ReasonDialog (focus piégé dans le dialogue, titre, fermeture nommée)", async () => {
    renderWithProviders(
      <>
        <ModalDialog open onOpenChange={() => undefined} title="Détails">
          <p>Contenu</p>
        </ModalDialog>
      </>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Détails" });
    // Radix déplace le focus dans le dialogue à l'ouverture.
    expect(dialog.contains(document.activeElement)).toBe(true);
    await expectNoBlockingViolations(document.body);
  });

  it("FormDialog et ReasonDialog", async () => {
    const { unmount } = renderWithProviders(
      <FormDialog open onOpenChange={() => undefined} title="Créer" description="Saisir" submitLabel="Créer" onSubmit={() => undefined} error={new Error("boom")}>
        <FormField label="Nom" required>{(c) => <TextControl {...c} value="" onChange={() => undefined} />}</FormField>
      </FormDialog>,
    );
    await screen.findByRole("dialog");
    await expectNoBlockingViolations(document.body);
    unmount();
    renderWithProviders(<ReasonDialog open onOpenChange={() => undefined} title="Clôturer" reasonLabel="Motif" confirmLabel="Clôturer" destructive onConfirm={() => undefined} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);
    await expectNoBlockingViolations(document.body);
  });

  it("Wizard, états, en-tête, zone de dépôt", async () => {
    const { container } = renderWithProviders(
      <div>
        <PageHeader title="Élèves" description="Liste" actions={<button type="button">Ajouter</button>} />
        <LoadingBlock />
        <ErrorBlock error={new Error("x")} onRetry={() => undefined} />
        <EmptyBlock title="Rien" description="Aucune donnée" />
        <Notice kind="success">Enregistré</Notice>
        <Notice kind="warning">Attention</Notice>
        <UploadDropzone onFile={() => undefined} extensions={["pdf"]} maxBytes={1024} />
        <Wizard
          label="Inscription"
          finishLabel="Terminer"
          onFinish={() => undefined}
          steps={[
            { id: "a", title: "Identité", content: <FormField label="Nom">{(c) => <TextControl {...c} value="" onChange={() => undefined} />}</FormField> },
            { id: "b", title: "Récapitulatif", content: <p>Ok</p> },
          ]}
        />
      </div>,
    );
    await expectNoBlockingViolations(container);
  });

  it("coquille (Shell) : lien d'évitement, navigation, tiroir mobile ouvert", async () => {
    const { container } = renderWithProviders(
      <Shell items={items} navLabel="Navigation" title="Mon école" headerRight={<button type="button">Compte</button>}>
        <PageHeader title="Audit" />
      </Shell>,
    );
    // Les règles de page (région, titre) sont actives ici : la coquille est complète.
    await expectNoBlockingViolations(container);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    await expectNoBlockingViolations(container);
  });

  it("PlatformSidebar : chargement et liste", async () => {
    const { container, rerender } = renderWithProviders(<PlatformSidebar items={[]} isLoading />);
    await expectNoBlockingViolations(container);
    rerender(<PlatformSidebar items={items} onClose={() => undefined} />);
    await expectNoBlockingViolations(container);
  });
});
